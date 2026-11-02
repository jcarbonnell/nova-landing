// nova-landing/test/check-nova-encode.ts
// W0 harness: the chat's browser encoder (src/lib/nova-encode.ts) produces files the
// NOVA SDK decodes byte-for-byte, with the SDK's own v1 descriptor.
//   Run (from nova-landing/): npx tsx test/check-nova-encode.ts
// Reference = the installed nova-sdk-js (its format.js is byte-identical in 1.2.5
// and 1.4.0). E6 is a mutation check on the old crypto.ts base64 step.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto, createHash } from 'node:crypto';
import { encodeFile } from '../src/lib/nova-encode';

const require = createRequire(import.meta.url);
const sdk = require('nova-sdk-js') as {
  encodeFile: (d: Buffer, k: string, o?: object) => Promise<{ bytes_b64: string; format: object }>;
  decodeFile: (b: string, k: string, f: object | null) => Promise<Buffer>;
};
const sdkVersion = require('nova-sdk-js/package.json').version;

const KEY = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
const OTHER_KEY = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
const rand = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) webcrypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  return b;
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
async function rejects(p: Promise<unknown>, label: string) {
  try { await p; } catch { return; }
  throw new Error(`${label}: expected a rejection`);
}

async function main() {
  console.log(`nova-sdk-js@${sdkVersion}`);

  await test('E1 SDK decodes our output byte-for-byte (0 B, 1 KB, 5 MB)', async () => {
    for (const n of [0, 1024, 5 * 1024 * 1024]) {
      const plain = rand(n);
      const { bytes_b64, format } = await encodeFile(plain, KEY);
      const back = await sdk.decodeFile(bytes_b64, KEY, format);
      assert.equal(back.length, n, `${n} B: length`);
      assert.equal(sha(back), sha(plain), `${n} B: hash mismatch`);
    }
  });

  await test('E2 our descriptor equals the SDK upload() descriptor (encodeFile, no options)', async () => {
    const plain = rand(777);
    const ours = await encodeFile(plain, KEY);
    const theirs = await sdk.encodeFile(Buffer.from(plain), KEY);
    assert.deepEqual(ours.format, theirs.format);
  });

  await test('E3 same wire layout as the SDK: IV(12) + ciphertext + tag(16)', async () => {
    const plain = rand(100);
    const ours = Buffer.from((await encodeFile(plain, KEY)).bytes_b64, 'base64');
    const theirs = Buffer.from((await sdk.encodeFile(Buffer.from(plain), KEY)).bytes_b64, 'base64');
    assert.equal(ours.length, 12 + 100 + 16);
    assert.equal(ours.length, theirs.length);
  });

  await test('E4 a fresh IV per call (two encodes of the same file differ)', async () => {
    const plain = rand(64);
    const a = await encodeFile(plain, KEY);
    const b = await encodeFile(plain, KEY);
    assert.notEqual(a.bytes_b64, b.bytes_b64);
  });

  await test('E5 tampered ciphertext and a wrong key are refused by the SDK decoder', async () => {
    const { bytes_b64, format } = await encodeFile(rand(256), KEY);
    const raw = Buffer.from(bytes_b64, 'base64');
    raw[20] ^= 0x01;
    await rejects(sdk.decodeFile(raw.toString('base64'), KEY, format), 'tampered');
    await rejects(sdk.decodeFile(bytes_b64, OTHER_KEY, format), 'wrong key');
  });

  await test('E6 mutation — the old crypto.ts base64 step throws on 5 MB (the bug E1 covers)', async () => {
    const big = rand(5 * 1024 * 1024);
    assert.throws(() => btoa(String.fromCharCode(...big)), RangeError);
  });

  await test('E7 a key of the wrong length is refused, never truncated', async () => {
    const longKey = Buffer.from(rand(48)).toString('base64');
    await rejects(encodeFile(rand(16), longKey), '48-byte key');
  });

  const total = 7;
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });