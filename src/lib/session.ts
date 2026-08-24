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

import { SignJWT } from 'jose';

const ISSUER = 'https://nova-sdk.com';
// MCP audience (-8000). Same value session-token/route.ts used; do not change
// without auditing MCP's verifier (SESSION_TOKEN_AUDIENCE in its env).
const AUDIENCE = 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

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