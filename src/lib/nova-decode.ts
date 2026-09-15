// nova-landing/src/lib/nova-decode.ts
//
// Browser-native decrypt for the dashboard (Phase 3). A behavioral port of
// nova-sdk-js's decode path (format.ts + legacy/v0.ts), deliberately NOT a
// dependency on the SDK:
//   • the SDK's decode logic is FROZEN (v0 never changes; v1 is stable), so drift
//     risk is near-zero — and 3c's harness proves byte-identical decode against
//     real ciphertext, so "same bytes as the SDK" is verified, not assumed;
//   • importing nova-sdk-js drags @near-js/providers + axios + the NovaSdk class
//     into the browser bundle, and needs a Buffer polyfill + subpath-import
//     discipline (the Phase 0 pre-check's remediation). This module needs NONE
//     of that: it is pure browser primitives (crypto.subtle, DecompressionStream,
//     Uint8Array) — exactly the browser branch the pre-check proved byte-correct.
//
// Server never sees plaintext or the derived key beyond brokering the wrapped
// key + ciphertext (prepare-retrieve, 3a). Everything here runs in the authorized
// member's browser.
//
// FORMAT CONTRACT (must match the SDK exactly):
//   • wire layout: base64( IV(12) || ciphertext || authTag(16) ), AES-256-GCM.
//     crypto.subtle appends the 16-byte tag to the ciphertext, so decrypt takes
//     IV(12) + everything-after as the ciphertext-with-tag (no manual tag split).
//   • dispatch: format == null/absent ⇒ v0 (legacy, frozen decrypt, no compression);
//     version 1 ⇒ v0 decrypt then OPTIONAL deflate-inflate; unknown ⇒ throw.
//   • v1 compression: only 'deflate' (RFC1950 zlib), via DecompressionStream.
//     'brotli' is schema-allowed but not implemented (mirrors the SDK).

// The format descriptor as returned by MCP prepare_retrieve (subset we read).
export interface FileFormatV1 {
  version: 1;
  backend?: string;
  encryption?: string;
  wrapping?: string;
  compression?: 'deflate';
  original_size?: number;
  content_type?: string;
}
export type FileFormat = FileFormatV1;

export class NovaDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NovaDecodeError';
  }
}

// ── base64 <-> bytes (browser-native, no Buffer) ─────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── v0 decrypt: AES-256-GCM via SubtleCrypto ─────────────────────────────────
//
// Verbatim behavioral match of legacy/v0.ts's browser branch:
//   iv = bytes[0..12); ciphertext(+tag) = bytes[12..]. key is base64(32 bytes).
async function decryptV0(encryptedB64: string, keyB64: string): Promise<Uint8Array> {
  const encrypted = base64ToBytes(encryptedB64);
  const keyBytes = base64ToBytes(keyB64);

  if (keyBytes.length !== 32) {
    throw new NovaDecodeError(`key must be 32 bytes, got ${keyBytes.length}`);
  }
  if (encrypted.length < 28) {
    // 12 (IV) + 16 (min GCM tag)
    throw new NovaDecodeError('ciphertext too short');
  }

  const iv = encrypted.slice(0, 12);
  const ciphertextWithTag = encrypted.slice(12); // subtle expects tag appended
  const keyForImport = keyBytes.slice(); // fresh ArrayBuffer-backed copy

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey('raw', keyForImport, { name: 'AES-GCM' }, false, ['decrypt']);
  } catch (e) {
    throw new NovaDecodeError(`key import failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertextWithTag);
  } catch {
    // GCM auth failure (wrong key or tampered ciphertext) throws here. Surface a
    // clean error — the caller treats a decrypt failure as "cannot verify".
    throw new NovaDecodeError('decryption failed (wrong key or corrupted data)');
  }

  return new Uint8Array(plaintext);
}

// ── deflate inflate (v1 optional compression) ────────────────────────────────
//
// RFC1950 zlib via DecompressionStream('deflate') — byte-compatible with the
// SDK's compress path (WHATWG CompressionStream / Node zlib), proven in the
// Phase 0 pre-check. Browser-native; no fallback needed (the dashboard is a
// browser; DecompressionStream is universally present in supported targets).
async function inflateDeflate(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (typeof DS === 'undefined') {
    throw new NovaDecodeError('DecompressionStream unavailable in this environment');
  }
  // Copy into a fresh ArrayBuffer-backed view (Blob rejects SharedArrayBuffer-
  // backed views) — same guard the SDK uses.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DS('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

// ── decodeFile: dispatch on format version ───────────────────────────────────
//
// Behavioral match of nova-sdk-js decodeFile. Returns the PLAINTEXT bytes.
export async function decodeFile(
  encryptedB64: string,
  keyB64: string,
  format?: FileFormat | null,
): Promise<Uint8Array> {
  const version = format?.version ?? 0;

  if (version === 0) {
    // Legacy / no-metadata path: plain v0 AES-256-GCM, no compression.
    return decryptV0(encryptedB64, keyB64);
  }

  if (version === 1) {
    const payload = await decryptV0(encryptedB64, keyB64); // same AES-GCM layout
    if (format?.compression === 'deflate') {
      return inflateDeflate(payload);
    }
    if (format?.compression) {
      throw new NovaDecodeError(
        `compression '${format.compression}' is not implemented (deflate only)`,
      );
    }
    return payload;
  }

  throw new NovaDecodeError(`unsupported file format version: ${version}`);
}

// ── integrity hash: SHA-256 of the plaintext (matches the on-chain file_hash) ─
//
// The contract's file_hash is SHA-256 of the PLAINTEXT (the SDK hashes the
// original bytes before encryption). The badge recomputes it on the decoded
// bytes and compares. Returns lowercase hex.
export async function sha256Hex(data: Uint8Array): Promise<string> {
  // .slice() yields a plain Uint8Array<ArrayBuffer>, satisfying subtle's typing.
  const copy = data.slice();
  const digest = await crypto.subtle.digest('SHA-256', copy);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}