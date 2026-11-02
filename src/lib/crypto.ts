// lib/crypto.ts - SHA-256 of plaintext (the on-chain integrity anchor).
// Encryption lives in nova-encode.ts, decryption in nova-decode.ts (W0).

export async function hashData(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}