// nova-landing/test-agent-identity-routes.mjs
//
// HARNESS (before any image): the two new proxy routes
//   /api/auth/agent-identity/challenge  and  /api/auth/agent-identity/verify
// run for real inside `next dev`, against a STUB Shade this script starts on
// 127.0.0.1:4999. The stub records every request, so the harness asserts what
// the routes SEND (internal secret present, only the known fields forwarded) as
// well as what they RETURN (status mapping, token minted correctly, no cookie).
// The wallet routes get a pass-through regression check too.
//
// TERMINAL 1 (from nova-landing/) — dev server pointed at the stub, test secrets:
//   NEXT_PUBLIC_SHADE_API_URL=http://127.0.0.1:4999 \
//   INTERNAL_API_SECRET=$(printf 'a%.0s' {1..64}) \
//   SESSION_TOKEN_SECRET=harness-session-secret \
//   npm run dev
//
// TERMINAL 2 (from nova-landing/):
//   node test-agent-identity-routes.mjs
//   (BASE=http://localhost:3001 node … if dev runs on another port)
//
// Command-line env overrides .env.local for that dev process only; your real
// secrets are neither needed nor touched.

import http from 'node:http';
import { jwtVerify } from 'jose';

const BASE = process.env.BASE || 'http://localhost:3000';
const INTERNAL = 'a'.repeat(64);
const SESSION_SECRET = 'harness-session-secret';
const ISSUER = 'https://nova-sdk.com';
const AUDIENCE = 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

const IMPLICIT = 'a3'.repeat(32);
const CHALLENGE_OK = '11'.repeat(32);

// ── stub Shade ──────────────────────────────────────────────────────────────
const seen = [];
let challengeMode = 'ok';
const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = null; try { body = JSON.parse(raw || 'null'); } catch {}
    seen.push({ path: req.url, auth: req.headers['x-internal-auth'], body });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-internal-auth'] !== INTERNAL) return send(403, { error: 'Forbidden', code: 'FORBIDDEN' });

    if (req.url === '/rpc/wallet/nonce') return send(200, { nonce: 'cd'.repeat(32) });
    if (req.url === '/rpc/agent-identity/challenge') {
      if (challengeMode === 'full') return send(503, { error: 'Too many', code: 'CHALLENGE_CAPACITY' });
      if (challengeMode === 'garbage') return send(200, { nope: true });
      return send(200, { message: '{"audience":"nova-sdk.near"}', challenge: CHALLENGE_OK, audience: 'nova-sdk.near', expires_at_ms: 1_900_000_000_000 });
    }
    if (req.url === '/rpc/agent-identity/verify') {
      const c = body?.challenge;
      if (c === CHALLENGE_OK) return send(200, { account_id: IMPLICIT, public_key: 'ed25519:x' });
      if (c === 'replay') return send(401, { error: 'Invalid or expired challenge', code: 'UNAUTHORIZED_NONCE_REPLAY' });
      if (c === 'badsig') return send(401, { error: 'Agent identity verification failed', code: 'UNAUTHORIZED' });
      if (c === 'down') return send(503, { error: 'Account lookup unavailable, retry shortly', code: 'KEY_LOOKUP_UNAVAILABLE' });
      if (c === 'invalid') return send(400, { error: 'Invalid request body', code: 'VALIDATION_FAILED' });
      if (c === 'noacct') return send(200, {});
      if (c === 'boom') return send(500, { error: 'Internal error', code: 'INTERNAL' });
    }
    send(404, { error: 'stub: unknown' });
  });
});
await new Promise((r) => stub.listen(4999, '127.0.0.1', r));

// ── harness ─────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${!cond && extra ? '\n       ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const post = async (path, body, raw) => {
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, cookie: res.headers.get('set-cookie') };
};
const lastShade = () => seen[seen.length - 1];
const sig = (challenge, extra = {}) => ({
  challenge,
  signature: { near_account_id: IMPLICIT, public_key: 'ed25519:x', signature: 'ab'.repeat(64), nonce: 'AAAA', recipient: 'nova-sdk.near', ...extra },
});

try {
  const ping = await fetch(BASE + '/api/auth/wallet-nonce', { method: 'POST' }).catch(() => null);
  if (!ping) { console.error(`FATAL: no dev server at ${BASE} (see header for the terminal-1 command)`); process.exit(2); }
  if (ping.status !== 200) {
    console.error(`FATAL: dev server is not pointed at the stub with the test secret (wallet-nonce → ${ping.status}). See header.`);
    process.exit(2);
  }

  console.log('\nchallenge route:');
  {
    const n = seen.length;
    const r = await post('/api/auth/agent-identity/challenge', {});
    check('1.1 200 with { message, challenge, audience, expires_at_ms }',
      r.status === 200 && r.json?.challenge === CHALLENGE_OK && r.json?.audience === 'nova-sdk.near' && typeof r.json?.message === 'string' && typeof r.json?.expires_at_ms === 'number', r.text);
    check('1.2 forwarded to Shade with the internal secret', seen.length === n + 1 && lastShade().path === '/rpc/agent-identity/challenge' && lastShade().auth === INTERNAL);
    check('1.3 response never echoes the internal secret', !r.text.includes(INTERNAL));
    check('1.4 no cookie set', r.cookie === null);
    challengeMode = 'full';
    const r2 = await post('/api/auth/agent-identity/challenge', {});
    check('1.5 Shade 503 (capacity) → 503, retryable', r2.status === 503 && r2.json?.code === 'CHALLENGE_CAPACITY', `${r2.status} ${r2.text}`);
    challengeMode = 'garbage';
    const r3 = await post('/api/auth/agent-identity/challenge', {});
    check('1.6 malformed Shade 200 → 502', r3.status === 502, `${r3.status} ${r3.text}`);
    challengeMode = 'ok';
  }

  console.log('\nverify route — success:');
  {
    const r = await post('/api/auth/agent-identity/verify', { ...sig(CHALLENGE_OK), message: 'client-supplied', evil: 1 });
    check('2.1 200 with { token, account_id, expires_in }', r.status === 200 && typeof r.json?.token === 'string' && r.json?.account_id === IMPLICIT, `${r.status} ${r.text}`);
    check('2.2 NO cookie set (backend caller)', r.cookie === null, String(r.cookie));
    const fwd = lastShade();
    check('2.3 forwarded to /rpc/agent-identity/verify with the internal secret', fwd.path === '/rpc/agent-identity/verify' && fwd.auth === INTERNAL);
    check('2.4 forwarded body is EXACTLY { challenge, signature{5 fields} } (message/evil dropped)',
      JSON.stringify(Object.keys(fwd.body).sort()) === '["challenge","signature"]' &&
      JSON.stringify(Object.keys(fwd.body.signature).sort()) === '["near_account_id","nonce","public_key","recipient","signature"]',
      JSON.stringify(fwd.body));
    let claims = null;
    try {
      claims = (await jwtVerify(r.json.token, new TextEncoder().encode(SESSION_SECRET), { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE })).payload;
    } catch (e) { claims = { error: e.message }; }
    check('2.5 token verifies (HS256, iss, aud) — same shape MCP accepts',
      claims && claims.type === 'nova_session' && claims.account_id === IMPLICIT, JSON.stringify(claims));
    check('2.6 subject is wallet|<account>', claims?.sub === `wallet|${IMPLICIT}`, String(claims?.sub));
    const extraSig = await post('/api/auth/agent-identity/verify', sig(CHALLENGE_OK, { injected: 'x' }));
    check('2.7 extra field inside signature is not forwarded', extraSig.status === 200 && !('injected' in lastShade().body.signature));
  }

  console.log('\nverify route — refusals:');
  {
    const cases = [
      ['3.1 replay → 401 UNAUTHORIZED_NONCE_REPLAY', 'replay', 401, 'UNAUTHORIZED_NONCE_REPLAY'],
      ['3.2 bad signature → 401 UNAUTHORIZED', 'badsig', 401, 'UNAUTHORIZED'],
      ['3.3 lookup unavailable → 503 KEY_LOOKUP_UNAVAILABLE (retryable)', 'down', 503, 'KEY_LOOKUP_UNAVAILABLE'],
      ['3.4 Shade validation → 400 VALIDATION_FAILED', 'invalid', 400, 'VALIDATION_FAILED'],
      ['3.5 Shade 500 → 502 (upstream), not 500 leak', 'boom', 502, 'INTERNAL'],
    ];
    for (const [name, c, st, code] of cases) {
      const r = await post('/api/auth/agent-identity/verify', sig(c));
      check(name + ' — and no token', r.status === st && r.json?.code === code && r.json?.token === undefined && r.cookie === null, `${r.status} ${r.text}`);
    }
    const r = await post('/api/auth/agent-identity/verify', sig('noacct'));
    check('3.6 Shade 200 without account_id → 502, no token', r.status === 502 && r.json?.token === undefined, `${r.status} ${r.text}`);
  }

  console.log('\nverify route — rejected before Shade:');
  {
    const n = seen.length;
    const r1 = await post('/api/auth/agent-identity/verify', undefined, '{not json');
    check('4.1 malformed JSON → 400', r1.status === 400);
    const r2 = await post('/api/auth/agent-identity/verify', { challenge: CHALLENGE_OK });
    check('4.2 missing signature → 400', r2.status === 400);
    const s = sig(CHALLENGE_OK); delete s.signature.nonce;
    const r3 = await post('/api/auth/agent-identity/verify', s);
    check('4.3 signature missing a field → 400', r3.status === 400);
    const r4 = await post('/api/auth/agent-identity/verify', sig(CHALLENGE_OK, { recipient: 42 }));
    check('4.4 non-string field → 400', r4.status === 400);
    const r5 = await post('/api/auth/agent-identity/verify', { challenge: 7, signature: sig('x').signature });
    check('4.5 non-string challenge → 400', r5.status === 400);
    check('4.6 none of 4.1–4.5 reached Shade', seen.length === n, `shade calls: ${seen.length - n}`);
  }

  console.log('\nwallet routes untouched:');
  {
    const r = await post('/api/auth/wallet-nonce', {});
    check('5.1 wallet-nonce still relays the nonce', r.status === 200 && r.json?.nonce === 'cd'.repeat(32), r.text);
    check('5.2 …via /rpc/wallet/nonce', lastShade().path === '/rpc/wallet/nonce');
  }

  console.log('\nShade unreachable:');
  {
    await new Promise((r) => stub.close(r));
    const r = await post('/api/auth/agent-identity/verify', sig(CHALLENGE_OK));
    check('6.1 verify with Shade down → 500 generic, no token, no internals', r.status === 500 && r.json?.token === undefined && !/ECONNREFUSED|127\.0\.0\.1|4999/.test(r.text), `${r.status} ${r.text}`);
    const r2 = await post('/api/auth/agent-identity/challenge', {});
    check('6.2 challenge with Shade down → 500 generic', r2.status === 500 && !/ECONNREFUSED|4999/.test(r2.text), `${r2.status} ${r2.text}`);
  }
} finally {
  stub.close?.();
}

console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
