// src/lib/log.ts
// Frontend structured logger with redact-by-construction, ported from the Shade
// agent's lib/logger + hashForLog pattern (roadmap §8.1a). PII is hashed here,
// not at call sites, so a property that depends on every author remembering is
// not relied upon.
import crypto from 'crypto';

// Fields whose values are PII and must never reach Vercel logs in the clear.
const PII_FIELDS = new Set([
  'email', 'sub', 'account_id', 'accountId', 'user_id', 'userId',
  'wallet_id', 'walletId', 'token', 'auth_token', 'authToken', 'api_key', 'apiKey',
]);

export function hashForLog(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) { out[k] = v; continue; }
    if (PII_FIELDS.has(k) && typeof v === 'string') {
      out[`${k}_hash`] = hashForLog(v);
    } else if (typeof v === 'string') {
      // Scrub secrets that may be embedded in free-text values (URLs, errors):
      // ?apiKey=, Bearer <jwt>, and ed25519 private keys (>=60 chars).
      out[k] = v
        .replace(/([?&]apiKey=)[^&\s]+/gi, '$1[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/ed25519:[A-Za-z0-9+/=]{60,}/g, 'ed25519:[redacted]');
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...redact(data) }));
}

export function logError(event: string, data: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event, ...redact(data) }));
}