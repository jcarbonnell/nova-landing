// lib/nova-crypto.ts - Client-side encryption w/ AES-256-GCM

const IV_LENGTH = 12;  // 96 bits for GCM
const KEY_LENGTH = 32; // 256 bits

export async function importKey(keyB64: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  
  return crypto.subtle.importKey(
    'raw',
    keyBytes.slice(0, KEY_LENGTH),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(
  plaintext: ArrayBuffer,
  key: CryptoKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  
  // Pack: [IV][ciphertext+tag] then base64 encode
  const packed = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), IV_LENGTH);
  
  return btoa(String.fromCharCode(...packed));
}

export async function decryptData(
  encryptedB64: string,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const encrypted = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  
  const iv = encrypted.slice(0, IV_LENGTH);
  const ciphertext = encrypted.slice(IV_LENGTH);
  
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
}

export async function hashData(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}