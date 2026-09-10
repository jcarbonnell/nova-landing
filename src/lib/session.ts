// nova-landing/src/lib/session.ts
//
// The ONE place a nova_session token is minted. Extracted verbatim from
// session-token/route.ts (v0.5 §5.11-A) so the wallet-verify route can mint the
// same token without duplicating the SignJWT block.
//
// WHY A NEW MODULE (not auth0.ts, not utils.ts):
//   - The mint is Auth0-INDEPENDENT: the API-key path and the new wallet path
//     both mint sessions with no Auth0 involvement. §5.11-B retires auth0.ts but
//     the mint survives — coupling them would be backwards.
//   - utils.ts is a client-imported Tailwind helper (cn()). A module that reads
//     SESSION_TOKEN_SECRET must never be reachable from the client bundle. This
//     file is server-only by virtue of what it imports.
//
// INVARIANTS (a change here changes every session in the system):
//   - alg HS256, aud = the MCP URL (-8000), iss = nova-sdk.com. MCP verifies all
//     three. The aud is the MCP port (8000), NOT the shade port (3000) — the
//     nova_session is consumed by MCP /tools/*, so it carries MCP's audience.
//   - claims { account_id, type: 'nova_session' }, subject = `${kind}|${id}`.
//   These are byte-identical to what session-token/route.ts minted before the
//   extraction; the wallet path reuses them so every issuer converges on ONE
//   token shape (email|…, apikey|…, wallet|…).

import { SignJWT, jwtVerify } from 'jose';

// Exported so the ONE mint audience/issuer is also the ONE verify audience/issuer
// (verifyNovaSession below reuses them). Co-location is the anti-drift guarantee:
// mint and verify cannot disagree because they read the same module constants.
export const ISSUER = 'https://nova-sdk.com';
// MCP audience (-8000). Same value session-token/route.ts used; do not change
// without auditing MCP's verifier (SESSION_TOKEN_AUDIENCE in its env).
export const AUDIENCE = 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

// 24h default, configurable — unchanged from the original route.
const TOKEN_EXPIRY = process.env.SESSION_TOKEN_EXPIRY || '24h';

export interface NovaSessionResult {
  token: string;
  account_id: string;
  expires_in: string;
}

/**
 * Mint a signed nova_session JWT.
 *
 * @param accountId  the verified NEAR account the session authorises.
 * @param subject    the JWT `sub`, encoding how identity was established:
 *                   `email|<email>`, `apikey|<account>`, or `wallet|<account>`.
 *
 * Throws if SESSION_TOKEN_SECRET is absent. Callers already guard on it (the
 * routes check it alongside the Shade URL and return a 500 before reaching
 * here); this throw is defence-in-depth so a future caller can't silently mint
 * an unsigned/duplicated-secret token.
 */
export async function mintNovaSession(
  accountId: string,
  subject: string,
): Promise<NovaSessionResult> {
  const sessionSecret = process.env.SESSION_TOKEN_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_TOKEN_SECRET is not configured');
  }

  const secret = new TextEncoder().encode(sessionSecret);

  const token = await new SignJWT({
    account_id: accountId,
    type: 'nova_session',
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secret);

  return { token, account_id: accountId, expires_in: TOKEN_EXPIRY };
}

// ────────────────────────────────────────────────
// Verify a nova_session (frontend mirror of Shade's verifyNovaSession).
// ────────────────────────────────────────────────
//
// The /app gate uses this to establish identity from the httpOnly nova_session
// cookie (wallet users) BEFORE rendering — per §5.0, identity is verified, never
// asserted from an unverified decode. Mirrors Shade's verifyNovaSession check-
// for-check (HS256 only; issuer; audience; type === 'nova_session'; non-empty
// account_id + sub), but with `jose` (async) since that is what mints the token
// here — same library, tightest symmetry, no cross-lib HS256 edge cases.
//
// Verifies against the token's AS-MINTED audience (the MCP -8000 URL). The gate
// is not itself the audience; like Shade, it checks that the token carries the
// audience it was minted with. Throws on ANY failure so the caller can try/catch
// and fall through (a stale cookie must never hard-block); returns claims on
// success.

export interface NovaSessionClaims {
  account_id: string;
  subject: string; // the JWT `sub`: `email|…`, `apikey|…`, or `wallet|…`
}

export async function verifyNovaSession(token: string): Promise<NovaSessionClaims> {
  const sessionSecret = process.env.SESSION_TOKEN_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_TOKEN_SECRET is not configured');
  }
  const secret = new TextEncoder().encode(sessionSecret);

  let payload: Record<string, unknown>;
  try {
    // HS256 ONLY — never allow an alg downgrade. jose enforces iss/aud/exp.
    const result = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    payload = result.payload as Record<string, unknown>;
  } catch {
    // Bad signature, wrong alg/iss/aud, expired, or malformed — all land here.
    throw new Error('Invalid or expired session');
  }

  if (payload.type !== 'nova_session') {
    throw new Error('Invalid session type');
  }

  const account_id = payload.account_id;
  const subject = payload.sub;
  if (typeof account_id !== 'string' || !account_id || typeof subject !== 'string' || !subject) {
    throw new Error('Invalid session claims');
  }

  return { account_id, subject };
}