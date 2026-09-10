// nova-landing/test-verify-nova-session.mjs
// Run: npx tsx test-verify-nova-session.mjs
//
// Offline harness for nova-landing's verifyNovaSession (lib/session.ts, A2).
//
// WHY: the /app gate decides "render the dashboard" from a nova_session cookie.
// That is an identity decision, so per §5.0 it must be ESTABLISHED (signature
// verified), never asserted from an unverified decode. This harness is the
// standalone gate on that verification BEFORE it ships (§10: auth changes get a
// harness first). It mirrors Shade's own verifyNovaSession harness (which proved
// jose-mint → jsonwebtoken-verify); here it is jose-mint → jose-verify, the
// tightest possible symmetry since the SAME library mints and verifies.
//
// It proves:
//   • a token minted by mintNovaSession verifies and returns { account_id, subject }
//   • every failure mode is REJECTED (throws): forged secret, wrong issuer,
//     wrong audience, expired, wrong `type`, missing account_id, alg:none
//     downgrade, malformed.
//
// The valid case uses the REAL mintNovaSession, so it also proves mint/verify
// share one issuer/audience/secret by construction (the A2 anti-drift claim).
// The negative cases craft tokens with jose directly, deviating in exactly one
// dimension from the correct ISSUER/AUDIENCE imported from session.ts — so a
// rejection is attributable to the intended defect, not an incidental mismatch.
//
// EXPECTED RED until the session.ts edit: this imports `verifyNovaSession`,
// `ISSUER`, and `AUDIENCE` from session.ts, which don't exist/aren't exported
// yet. The import error naming those missing exports IS the expected first-run
// failure; it turns green once edit #2 adds them.

// Set the secret BEFORE importing session.ts, then dynamic-import so the module
// evaluates with env in place (matches test-finalize-proxy.mjs's `await import`).
process.env.SESSION_TOKEN_SECRET =
  process.env.SESSION_TOKEN_SECRET || 'harness-only-secret-do-not-use-in-prod-0123456789';

import { SignJWT } from 'jose';

const { mintNovaSession, verifyNovaSession, ISSUER, AUDIENCE } = await import('../src/lib/session.ts');

const SECRET = process.env.SESSION_TOKEN_SECRET;
const ACCT = 'gmail-14.nova-sdk.near';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}
async function rejects(fn, msg) {
  try {
    await fn();
    ok(false, `${msg} (expected throw, got success)`);
  } catch {
    ok(true, msg);
  }
}

// Craft a token deviating in exactly one dimension from a correct nova_session.
async function craft({
  secret = SECRET,
  iss = ISSUER,
  aud = AUDIENCE,
  type = 'nova_session',
  sub = `wallet|${ACCT}`,
  account_id = ACCT,
  exp = '24h',
  omitAccount = false,
} = {}) {
  const claims = { type };
  if (!omitAccount) claims.account_id = account_id;
  let b = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt();
  if (exp !== null) b = b.setExpirationTime(exp);
  return b.sign(new TextEncoder().encode(secret));
}

// A hand-built alg:none token (jose won't sign one) — the classic downgrade.
function craftAlgNone() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'none', typ: 'JWT' });
  const payload = b64({
    account_id: ACCT, type: 'nova_session', sub: `wallet|${ACCT}`,
    iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 3600,
  });
  return `${header}.${payload}.`;
}

// ── Case 1: valid mint→verify (wallet subject) ───────────────────────────────
console.log('\nCase 1: valid mint→verify (wallet subject)');
{
  const { token } = await mintNovaSession(ACCT, `wallet|${ACCT}`);
  const claims = await verifyNovaSession(token);
  ok(claims.account_id === ACCT, 'returns account_id from the signed claim');
  ok(claims.subject === `wallet|${ACCT}`, 'returns the wallet subject');
}

// ── Case 2: valid mint→verify (email subject) — same shape, different issuer ──
console.log('\nCase 2: valid mint→verify (email subject)');
{
  const { token } = await mintNovaSession(ACCT, 'email|foo@bar.com');
  const claims = await verifyNovaSession(token);
  ok(claims.account_id === ACCT && claims.subject === 'email|foo@bar.com',
    'email-subject session verifies (gate accepts any valid nova_session, not just wallet)');
}

// ── Case 3: forged secret → reject ───────────────────────────────────────────
console.log('\nCase 3: forged secret');
{
  const t = await craft({ secret: 'a-different-secret-that-is-not-the-real-one-9999' });
  await rejects(() => verifyNovaSession(t), 'token signed with the wrong secret is rejected');
}

// ── Case 4: wrong issuer → reject ────────────────────────────────────────────
console.log('\nCase 4: wrong issuer');
{
  const t = await craft({ iss: 'https://evil.example.com' });
  await rejects(() => verifyNovaSession(t), 'wrong issuer is rejected');
}

// ── Case 5: wrong audience → reject ──────────────────────────────────────────
console.log('\nCase 5: wrong audience');
{
  const t = await craft({ aud: 'https://not-the-mcp-url.example.com' });
  await rejects(() => verifyNovaSession(t), 'wrong audience is rejected');
}

// ── Case 6: expired → reject ─────────────────────────────────────────────────
console.log('\nCase 6: expired');
{
  const t = await craft({ exp: Math.floor(Date.now() / 1000) - 3600 }); // 1h in the past
  await rejects(() => verifyNovaSession(t), 'expired token is rejected');
}

// ── Case 7: wrong type claim → reject ────────────────────────────────────────
console.log('\nCase 7: wrong type claim');
{
  const t = await craft({ type: 'not_nova_session' });
  await rejects(() => verifyNovaSession(t), 'type != nova_session is rejected');
}

// ── Case 8: missing account_id → reject ──────────────────────────────────────
console.log('\nCase 8: missing account_id');
{
  const t = await craft({ omitAccount: true });
  await rejects(() => verifyNovaSession(t), 'missing account_id claim is rejected');
}

// ── Case 9: alg:none downgrade → reject ──────────────────────────────────────
console.log('\nCase 9: alg:none downgrade');
{
  const t = craftAlgNone();
  await rejects(() => verifyNovaSession(t), 'alg:none (unsigned) token is rejected');
}

// ── Case 10: malformed → reject ──────────────────────────────────────────────
console.log('\nCase 10: malformed token');
{
  await rejects(() => verifyNovaSession('not-a-jwt'), 'garbage string is rejected');
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);