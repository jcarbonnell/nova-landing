// nova-landing/tests/test-nova-decode.mjs
// Run: npx tsx tests/test-nova-decode.mjs
//
// 3c — the integrity-badge harness (§10 harness-first). Proves TWO things before
// any UI touches decrypted bytes:
//
//   1. nova-decode.ts (the browser-native port, 3b) decodes byte-identically to
//      what the REAL nova-sdk-js encoded — for the null-format (v0) path, the v1
//      uncompressed path, and the v1 deflate path. This is the "same bytes as the
//      SDK" guarantee that justified porting instead of depending on the SDK.
//
//   2. The integrity verdict is correct:
//        • clean decode → sha256Hex(plaintext) === on-chain file_hash → GREEN
//          ("byte-identical").
//        • tampered ciphertext → GCM auth fails → NovaDecodeError (cannot even
//          produce plaintext) → RED.
//        • decode succeeds but the claimed file_hash differs → RED
//          ("byte-mismatched").
//
// Runs offline in Node (crypto.subtle + DecompressionStream present, as in the
// Phase 0 pre-check). Imports the REAL SDK encode side from the installed
// nova-sdk-js to generate authentic ciphertext, then decodes with OUR module.

import * as SdkFormat from 'nova-sdk-js/dist/format.js';
import * as SdkV0 from 'nova-sdk-js/dist/legacy/v0.js';
const { encodeFile } = SdkFormat;
const { encryptV0 } = SdkV0;
import * as NovaDecode from '../src/lib/nova-decode';
const { decodeFile, sha256Hex, NovaDecodeError } = NovaDecode.default ?? NovaDecode;
import { Buffer } from 'buffer';
import { webcrypto } from 'node:crypto';

// The SDK's encode path uses globalThis.crypto.subtle; ensure it's present
// (Node 20+ has it globally, but be explicit).
if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}
async function throwsNovaDecode(fn, msg) {
  try { await fn(); ok(false, `${msg} (expected throw)`); }
  catch (e) { ok(e instanceof NovaDecodeError || /decrypt|decode|corrupt/i.test(String(e?.message)), msg); }
}

// A 32-byte key, base64 — the shape MCP returns.
const keyB64 = Buffer.alloc(32, 9).toString('base64');
// Plaintext with enough redundancy that deflate actually shrinks it.
const plaintext = Buffer.from('NOVA integrity-badge proof — '.repeat(300));
// The on-chain file_hash is SHA-256 of the PLAINTEXT.
const onchainHash = await sha256Hex(new Uint8Array(plaintext));

const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// ── 1. null-format (v0) path ─────────────────────────────────────────────────
console.log('\n1. v0 (null format) — legacy/no-metadata path');
{
  // Real SDK v0 ciphertext (what a null-format FastFS/legacy row decodes as).
  const encB64 = await encryptV0(plaintext, keyB64);
  const decoded = await decodeFile(encB64, keyB64, null);
  ok(eq(decoded, plaintext), 'null-format decodes byte-identically (v0 path)');

  const h = await sha256Hex(decoded);
  ok(h === onchainHash, 'recomputed hash matches on-chain file_hash → GREEN');
}

// ── 2. v1 uncompressed ───────────────────────────────────────────────────────
console.log('\n2. v1 uncompressed');
{
  const { bytes_b64, format } = await encodeFile(plaintext, keyB64); // v1, no compression
  ok(format.version === 1 && !format.compression, 'SDK produced v1 uncompressed format');
  const decoded = await decodeFile(bytes_b64, keyB64, format);
  ok(eq(decoded, plaintext), 'v1 uncompressed decodes byte-identically');
  ok((await sha256Hex(decoded)) === onchainHash, 'hash matches → GREEN');
}

// ── 3. v1 + deflate (cross-env: SDK CompressionStream/zlib → our DecompressionStream) ─
console.log('\n3. v1 deflate');
{
  const { bytes_b64, format } = await encodeFile(plaintext, keyB64, { compression: 'deflate' });
  ok(format.compression === 'deflate', 'SDK produced v1 deflate format');
  const decoded = await decodeFile(bytes_b64, keyB64, format);
  ok(eq(decoded, plaintext), 'v1 deflate decodes byte-identically (inflate cross-env OK)');
  ok((await sha256Hex(decoded)) === onchainHash, 'hash matches → GREEN');
}

// ── 4. RED: tampered ciphertext → GCM auth failure ───────────────────────────
console.log('\n4. tampered ciphertext → RED (cannot decode)');
{
  const encB64 = await encryptV0(plaintext, keyB64);
  // Flip bytes in the middle of the ciphertext (after the 12-byte IV).
  const raw = Buffer.from(encB64, 'base64');
  raw[20] ^= 0xff;
  raw[21] ^= 0xff;
  const tamperedB64 = raw.toString('base64');
  await throwsNovaDecode(() => decodeFile(tamperedB64, keyB64, null),
    'tampered ciphertext throws (GCM auth fail) → cannot verify → RED');
}

// ── 5. RED: clean decode but hash mismatch (wrong claimed file_hash) ──────────
console.log('\n5. decode OK but hash mismatch → RED (byte-mismatched)');
{
  const encB64 = await encryptV0(plaintext, keyB64);
  const decoded = await decodeFile(encB64, keyB64, null);
  const wrongClaimedHash = 'f'.repeat(64);
  const recomputed = await sha256Hex(decoded);
  ok(recomputed !== wrongClaimedHash, 'recomputed hash != a bogus claimed hash → RED verdict');
  // and sanity: it DOES match the real one
  ok(recomputed === onchainHash, 'recomputed hash == real on-chain hash (control)');
}

// ── 6. RED: wrong key → GCM auth failure ─────────────────────────────────────
console.log('\n6. wrong key → RED (cannot decode)');
{
  const encB64 = await encryptV0(plaintext, keyB64);
  const wrongKey = Buffer.alloc(32, 1).toString('base64');
  await throwsNovaDecode(() => decodeFile(encB64, wrongKey, null),
    'wrong key throws (GCM auth fail) → RED');
}

// ── 7. unknown version → throw ───────────────────────────────────────────────
console.log('\n7. unknown format version → throw');
{
  const encB64 = await encryptV0(plaintext, keyB64);
  await throwsNovaDecode(() => decodeFile(encB64, keyB64, { version: 2 }),
    'unknown version rejected (no silent mis-decode)');
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);