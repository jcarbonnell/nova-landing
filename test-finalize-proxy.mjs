// test-finalize-proxy.mjs
// Run: npx tsx test-finalize-proxy.mjs
// Offline harness for the finalize-upload proxy. Imports the REAL route handler
// and intercepts global fetch to mock session-token + MCP.

import { NextRequest } from 'next/server';

const ROUTE = './src/app/api/nova/finalize-upload/route.ts';

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

// ── fetch mock ──────────────────────────────────────────────────────────────
// Each test sets `mock` to control what session-token and MCP return, and reads
// `calls` to inspect what the route sent.
let mock;
let calls;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  const headers = Object.fromEntries(new Headers(options.headers).entries());
  const bodyStr = typeof options.body === 'string' ? options.body : '';
  const body = bodyStr ? JSON.parse(bodyStr) : {};

  if (u.includes('/api/auth/session-token')) {
    calls.sessionToken.push({ url: u, headers, body });
    return new Response(JSON.stringify(mock.sessionToken.body), {
      status: mock.sessionToken.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (u.includes('/tools/finalize_upload')) {
    calls.mcp.push({ url: u, headers, body });
    return new Response(JSON.stringify(mock.mcp.body), {
      status: mock.mcp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`Unexpected fetch to ${u}`);
};

function resetCalls() {
  calls = { sessionToken: [], mcp: [] };
}

function makeReq({ headers = {}, body } = {}) {
  return new NextRequest('https://nova-sdk.com/api/nova/finalize-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

const validBody = {
  upload_id: 'u-123',
  encrypted_data: 'AAAABBBBCCCC', // stand-in base64
  file_hash: 'a'.repeat(64),
};

const { POST } = await import(ROUTE);

// ── Case 1: wallet → 501, nothing minted or called ───────────────────────────
console.log('\nCase 1: wallet rejected at boundary');
{
  resetCalls();
  mock = { sessionToken: { status: 200, body: {} }, mcp: { status: 200, body: {} } };
  const res = await POST(makeReq({ headers: { 'x-wallet-id': 'foo.near' }, body: validBody }));
  const json = await res.json();
  assert(res.status === 501, 'returns 501');
  assert(json.code === 'WALLET_AUTH_PENDING_SELF_CUSTODY', 'returns wallet code');
  assert(calls.sessionToken.length === 0, 'did NOT mint a token');
  assert(calls.mcp.length === 0, 'did NOT call MCP');
}

// ── Case 2: missing fields → 400, no network ─────────────────────────────────
console.log('\nCase 2: missing fields');
{
  resetCalls();
  mock = { sessionToken: { status: 200, body: {} }, mcp: { status: 200, body: {} } };
  const res = await POST(makeReq({ body: { upload_id: 'u-123' } })); // no encrypted_data / file_hash
  assert(res.status === 400, 'returns 400');
  assert(calls.sessionToken.length === 0 && calls.mcp.length === 0, 'no network calls');
}

// ── Case 3: invalid JSON → 400 ───────────────────────────────────────────────
console.log('\nCase 3: invalid JSON body');
{
  resetCalls();
  mock = { sessionToken: { status: 200, body: {} }, mcp: { status: 200, body: {} } };
  const res = await POST(makeReq({ body: 'not json{' }));
  assert(res.status === 400, 'returns 400');
  assert(calls.mcp.length === 0, 'MCP not called');
}

// ── Case 4: no session → propagate 401, MCP never called ─────────────────────
console.log('\nCase 4: no Auth0 session');
{
  resetCalls();
  mock = {
    sessionToken: { status: 401, body: { error: 'Not authenticated' } },
    mcp: { status: 200, body: {} },
  };
  const res = await POST(makeReq({ body: validBody }));
  const json = await res.json();
  assert(res.status === 401, 'propagates 401');
  assert(json.error === 'Not authenticated', 'propagates session-token error');
  assert(calls.mcp.length === 0, 'did NOT call MCP without a token');
}

// ── Case 5: happy path → correct payload, client x-account-id ignored, unwrap ─
console.log('\nCase 5: happy path');
{
  resetCalls();
  mock = {
    sessionToken: { status: 200, body: { token: 'jwt-abc', account_id: 'gmail-14.nova-sdk.near' } },
    mcp: { status: 200, body: { result: { cid: 'QmXYZ', trans_id: 'tx-1', file_hash: 'a'.repeat(64) } } },
  };
  // Client sends a WRONG x-account-id — must be ignored.
  const res = await POST(makeReq({
    headers: { 'x-account-id': 'attacker.nova-sdk.near', cookie: 'appSession=real' },
    body: validBody,
  }));
  const json = await res.json();

  assert(res.status === 200, 'returns 200');
  assert(json.cid === 'QmXYZ' && json.trans_id === 'tx-1', 'unwraps MCP envelope (cid/trans_id at top level)');
  assert(json.result === undefined, 'does NOT double-wrap');

  // token mint forwarded the cookie, empty body
  assert(calls.sessionToken.length === 1, 'minted exactly one token');
  assert(calls.sessionToken[0].headers.cookie === 'appSession=real', 'forwarded the Auth0 cookie');

  // MCP call correctness
  assert(calls.mcp.length === 1, 'called MCP once');
  const mcpCall = calls.mcp[0];
  assert(mcpCall.headers.authorization === 'Bearer jwt-abc', 'sent Bearer session token');
  assert(mcpCall.headers['x-account-id'] === 'gmail-14.nova-sdk.near', 'sent RESOLVED account, not client x-account-id');
  assert(mcpCall.headers['x-account-id'] !== 'attacker.nova-sdk.near', 'client x-account-id was dropped');
  assert(
    mcpCall.body.upload_id === 'u-123' &&
    mcpCall.body.encrypted_data === 'AAAABBBBCCCC' &&
    mcpCall.body.file_hash === 'a'.repeat(64),
    'sent exactly {upload_id, encrypted_data, file_hash}'
  );
  const extraKeys = Object.keys(mcpCall.body).filter(
    (k) => !['upload_id', 'encrypted_data', 'file_hash'].includes(k)
  );
  assert(extraKeys.length === 0, 'no extra fields leaked into MCP payload');
}

// ── Case 6: MCP error → forwarded raw with its status ────────────────────────
console.log('\nCase 6: MCP error forwarded');
{
  resetCalls();
  mock = {
    sessionToken: { status: 200, body: { token: 'jwt-abc', account_id: 'gmail-14.nova-sdk.near' } },
    mcp: { status: 500, body: { error: 'Invalid or expired upload_id' } },
  };
  const res = await POST(makeReq({ body: validBody }));
  const json = await res.json();
  assert(res.status === 500, 'propagates MCP status');
  assert(json.error === 'Invalid or expired upload_id', 'propagates MCP error body (frontend reads err.error)');
}

globalThis.fetch = realFetch;

console.log(`\n${'─'.repeat(50)}`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);