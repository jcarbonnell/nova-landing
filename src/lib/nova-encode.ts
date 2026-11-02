// nova-landing/src/lib/nova-encode.ts
//
// W0 — browser-side v1 ENCODER for chat uploads; the counterpart of
// src/lib/nova-decode.ts (decodeFile). Behavioural match of nova-sdk-js
// encodeFile(data, key) with no options, which is what the SDK's upload() calls:
// v1 uncompressed = the frozen v0 AES-256-GCM layout base64(IV(12) || ciphertext ||
// tag(16)) plus a FileFormatV1 descriptor that finalize_upload persists, so
// retrieve can dispatch on it.
//
// Web Crypto only, no Buffer. Base64 is built in chunks: the old crypto.ts
// btoa(String.fromCharCode(...bytes)) spread every byte as a call argument and threw
// RangeError for files above a few hundred KB.
//
// Harness: test/check-nova-encode.ts (cross-checked against nova-sdk-js decodeFile).

const IV_LENGTH = 12;

export interface EncodedFileFormatV1 {
  version: 1;
  backend: 'fastfs';
  encryption: 'AES-256-GCM';
  wrapping: 'AES-GCM-keywrap';
  original_size: number;
  content_type: string;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/** Encode plaintext to the v1 format with the per-file key from prepare_upload. */
export async function encodeFile(
  plaintext: ArrayBuffer | Uint8Array,
  keyB64: string,
): Promise<{ bytes_b64: string; format: EncodedFileFormatV1 }> {
  // Copy into a plain ArrayBuffer-backed view (Web Crypto's BufferSource typing).
  const data = new Uint8Array(plaintext);
  // Full key bytes, as the SDK does (a wrong length is refused by importKey, never truncated).
  const key = await crypto.subtle.importKey('raw', base64ToBytes(keyB64), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const packed = new Uint8Array(IV_LENGTH + ct.length);
  packed.set(iv, 0);
  packed.set(ct, IV_LENGTH);
  return {
    bytes_b64: bytesToBase64(packed),
    // Same descriptor the SDK writes with no options (content_type: its default).
    format: {
      version: 1,
      backend: 'fastfs',
      encryption: 'AES-256-GCM',
      wrapping: 'AES-GCM-keywrap',
      original_size: data.length,
      content_type: 'application/octet-stream',
    },
  };
}