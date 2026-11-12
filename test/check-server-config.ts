// nova-landing/test/check-server-config.ts
// §5.12 item 10 harness: where NOVA lives and which audiences its tokens carry
// come from config only — no default, no retired CVM, refusals by name.
//   Run (from nova-landing/): npx tsx test/check-server-config.ts
//   (CommonJS package: no top-level await, so the checks run inside main().)
// Imports the REAL src/lib/server-config.ts and src/lib/session.ts. The values
// below are test fixtures, never real configuration; the session secret is a
// throwaway string.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import {
  mcpUrl, shadeApiUrl, auth0Audience, sessionAudience, ConfigError,
} from '../src/lib/server-config';
import { mintNovaSession, verifyNovaSession, ISSUER } from '../src/lib/session';

const VARS = ['MCP_URL', 'SHADE_API_URL', 'AUTH0_AUDIENCE', 'SESSION_TOKEN_AUDIENCE', 'SESSION_TOKEN_SECRET'] as const;
const GOOD = {
  MCP_URL: 'https://example-8000.test.invalid',
  SHADE_API_URL: 'https://example-3000.test.invalid',
  AUTH0_AUDIENCE: 'https://nova-sdk.com/api/shade',
  SESSION_TOKEN_AUDIENCE: 'https://nova-sdk.com/api/mcp',
  SESSION_TOKEN_SECRET: 'test-only-secret-not-a-real-value-0123456789abcdef',
};
function setEnv(over: Partial<Record<(typeof VARS)[number], string | undefined>> = {}) {
  for (const k of VARS) {
    const v = k in over ? over[k] : GOOD[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

let n = 0;
async function check(label: string, fn: () => void | Promise<void>) {
  setEnv();
  await fn();
  n++;
  console.log(`  ok  ${label}`);
}
function refuses(fn: () => unknown, message: string) {
  assert.throws(fn, (e: unknown) => e instanceof ConfigError && e.message === message,
    `expected ConfigError "${message}"`);
}
async function rejects(fn: () => Promise<unknown>, message: string) {
  await assert.rejects(fn, (e: unknown) => e instanceof Error && e.message === message,
    `expected rejection "${message}"`);
}

async function main() {
console.log('\nserver-config / session audience harness\n');

// ── C: the four getters ─────────────────────────────────────────────────────
await check('C1 valid values are returned (base URLs as origins)', () => {
  assert.equal(mcpUrl(), GOOD.MCP_URL);
  assert.equal(shadeApiUrl(), GOOD.SHADE_API_URL);
  assert.equal(auth0Audience(), GOOD.AUTH0_AUDIENCE);
  assert.equal(sessionAudience(), GOOD.SESSION_TOKEN_AUDIENCE);
});
await check('C2 a trailing slash on a base URL is normalised away', () => {
  setEnv({ MCP_URL: GOOD.MCP_URL + '/' });
  assert.equal(mcpUrl(), GOOD.MCP_URL);
});
await check('C3 missing / empty / blank → "<NAME> is not configured"', () => {
  for (const [name, get] of [
    ['MCP_URL', mcpUrl], ['SHADE_API_URL', shadeApiUrl],
    ['AUTH0_AUDIENCE', auth0Audience], ['SESSION_TOKEN_AUDIENCE', sessionAudience],
  ] as const) {
    for (const bad of [undefined, '', '   ']) {
      setEnv({ [name]: bad });
      refuses(get, `${name} is not configured`);
    }
  }
});
await check('C4 http:// refused', () => {
  setEnv({ SHADE_API_URL: 'http://example-3000.test.invalid' });
  refuses(shadeApiUrl, 'SHADE_API_URL must use https');
  setEnv({ AUTH0_AUDIENCE: 'http://nova-sdk.com/api/shade' });
  refuses(auth0Audience, 'AUTH0_AUDIENCE must use https');
});
await check('C5 not a URL refused', () => {
  setEnv({ MCP_URL: 'example-8000.test.invalid' });
  refuses(mcpUrl, 'MCP_URL is not a URL');
});
await check('C6 a base URL with a path refused', () => {
  setEnv({ MCP_URL: GOOD.MCP_URL + '/mcp' });
  refuses(mcpUrl, 'MCP_URL must be an origin only (no path)');
});
await check('C7 query, fragment, credentials refused', () => {
  setEnv({ MCP_URL: GOOD.MCP_URL + '/?apiKey=x' });
  refuses(mcpUrl, 'MCP_URL must not carry a query or fragment');
  setEnv({ SESSION_TOKEN_AUDIENCE: GOOD.SESSION_TOKEN_AUDIENCE + '#x' });
  refuses(sessionAudience, 'SESSION_TOKEN_AUDIENCE must not carry a query or fragment');
  setEnv({ SHADE_API_URL: 'https://u:p@example-3000.test.invalid' });
  refuses(shadeApiUrl, 'SHADE_API_URL must not carry credentials');
});
await check('C8 an audience with a trailing slash refused (exact-match trap)', () => {
  setEnv({ SESSION_TOKEN_AUDIENCE: GOOD.SESSION_TOKEN_AUDIENCE + '/' });
  refuses(sessionAudience, "SESSION_TOKEN_AUDIENCE must not end with '/'");
});
await check('C9 surrounding whitespace refused', () => {
  setEnv({ AUTH0_AUDIENCE: GOOD.AUTH0_AUDIENCE + ' ' });
  refuses(auth0Audience, 'AUTH0_AUDIENCE has leading or trailing whitespace');
});

// ── S: session mint/verify read the configured audience ─────────────────────
await check('S1 a minted token carries exactly SESSION_TOKEN_AUDIENCE and ISSUER', async () => {
  const { token } = await mintNovaSession('alice.near', 'wallet|alice.near');
  const c = decodeJwt(token);
  assert.equal(c.aud, GOOD.SESSION_TOKEN_AUDIENCE);
  assert.equal(c.iss, ISSUER);
  assert.deepEqual(await verifyNovaSession(token), { account_id: 'alice.near', subject: 'wallet|alice.near' });
});
let crossAudToken = '';
await check('S2 a token minted for another audience is refused', async () => {
  setEnv({ SESSION_TOKEN_AUDIENCE: 'https://old.test.invalid' });
  crossAudToken = (await mintNovaSession('alice.near', 'wallet|alice.near')).token;
  setEnv();
  await rejects(() => verifyNovaSession(crossAudToken), 'Invalid or expired session');
});
await check('S3 mint without an audience → "SESSION_TOKEN_AUDIENCE is not configured"', async () => {
  setEnv({ SESSION_TOKEN_AUDIENCE: undefined });
  await assert.rejects(() => mintNovaSession('alice.near', 'wallet|alice.near'),
    (e: unknown) => e instanceof ConfigError && e.message === 'SESSION_TOKEN_AUDIENCE is not configured');
});
await check('S4 verify without an audience surfaces the misconfiguration (not "invalid session")', async () => {
  const { token } = await mintNovaSession('alice.near', 'wallet|alice.near');
  setEnv({ SESSION_TOKEN_AUDIENCE: undefined });
  await assert.rejects(() => verifyNovaSession(token),
    (e: unknown) => e instanceof ConfigError && e.message === 'SESSION_TOKEN_AUDIENCE is not configured');
});

// ── R: no retired endpoint left in the files this step owns ─────────────────
const RETIRED = [/5a5223f7/i, /dstack-prod5\.phala\.network/i, /fastmcp\.app/i];
const retiredIn = (text: string) => RETIRED.filter((r) => r.test(text)).map(String);
const OWNED = ['src/lib/server-config.ts', 'src/lib/session.ts', 'src/lib/auth0.ts', 'next.config.ts'];
await check(`R1 no retired CVM / fastmcp reference in ${OWNED.length} owned files`, () => {
  for (const f of OWNED) assert.deepEqual(retiredIn(readFileSync(f, 'utf8')), [], `${f} still references a retired endpoint`);
});

// ── M: mutation checks (the detectors are not blind) ────────────────────────
await check('M1 S2 is caught by the audience check: without it the same token verifies', async () => {
  const secret = new TextEncoder().encode(GOOD.SESSION_TOKEN_SECRET);
  const r = await jwtVerify(crossAudToken, secret, { algorithms: ['HS256'], issuer: ISSUER });
  assert.equal(r.payload.aud, 'https://old.test.invalid');
});
await check('M2 R1 detects the pre-§5.12 code (old session.ts / next.config.ts lines)', () => {
  const OLD_SESSION = "export const AUDIENCE = 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';";
  const OLD_NEXT = "destination: `${process.env.MCP_URL || 'https://nova-mcp.fastmcp.app'}/mcp/:path*`,";
  assert.equal(retiredIn(OLD_SESSION).length, 2);
  assert.equal(retiredIn(OLD_NEXT).length, 1);
});
await check('M3 a defaulting getter would pass C1 but fail C3 (C3 is what forbids defaults)', () => {
  const defaulting = () => process.env.MCP_URL || 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';
  setEnv({ MCP_URL: undefined });
  assert.doesNotThrow(defaulting);
  refuses(mcpUrl, 'MCP_URL is not configured');
});
await check('M4 a hand-made token with the right audience but wrong secret is refused', async () => {
  const forged = await new SignJWT({ account_id: 'alice.near', type: 'nova_session' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('wallet|alice.near').setIssuer(ISSUER)
    .setAudience(GOOD.SESSION_TOKEN_AUDIENCE).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode('a-different-secret-entirely'));
  await rejects(() => verifyNovaSession(forged), 'Invalid or expired session');
});

console.log(`\n${n}/${n} passed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
