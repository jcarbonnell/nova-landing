// nova-landing/src/lib/nova-proxy.ts
//
// The ONE place a same-origin /api/nova/* route resolves the caller's identity
// into a { sessionToken, accountId } pair to forward to MCP.
//
// WHY THIS EXISTS (§5.0 / Step 4 anti-drift): finalize-upload already contained
// this exact block, and EVERY new read proxy (groups, members, transactions)
// needs the identical logic. Copy-pasting it per route is precisely the
// drift hazard that lets one route's auth quietly diverge from another's. One
// helper, many thin routes — the same "one implementation, two surfaces" move
// that services/*.ts made on the Shade side.
//
// DUAL-SOURCE, cookie-first — identical to finalize-upload's proven model and to
// the /app gate:
//   1. nova_session httpOnly cookie (wallet SIWN users, and any minted session):
//      decode the account_id from the claim, use the cookie verbatim as the
//      Bearer. NOTE: MCP re-verifies this token's HS256 signature on every
//      /tools/* call (get_current_user), so a forged cookie gets nothing — the
//      decode here is only to read the account_id for the x-account-id
//      cross-check header; it is NOT the trust boundary.
//   2. else mint from the Auth0 session by calling our own /api/auth/session-token
//      (Path 3), forwarding the request cookies. That route verifies the Auth0
//      session and returns { token, account_id }.
//
// The client's x-account-id is NEVER read or trusted here (v0.4 Fix A). Identity
// is resolved server-side; callers pass the RESOLVED account to MCP.
//
// Contract: returns { sessionToken, accountId } on success, or throws a
// NovaProxyAuthError carrying the HTTP status + message the route should emit.
// This mirrors the services/*.ts "throw a typed error, the adapter maps it"
// shape — routes stay thin.

import type { NextRequest } from 'next/server';

export interface NovaSession {
  sessionToken: string;
  accountId: string;
}

// Thrown when identity cannot be established. The route turns this into a
// JSON response with `.status`. Kept deliberately opaque (no internal detail).
export class NovaProxyAuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NovaProxyAuthError';
  }
}

/**
 * Resolve the caller's { sessionToken, accountId } from the request.
 *
 * @throws NovaProxyAuthError with the status/message the route should return.
 */
export async function resolveNovaSession(req: NextRequest): Promise<NovaSession> {
  // ── Source 1: wallet nova_session cookie ────────────────────────────────
  const walletSession = req.cookies.get('nova_session')?.value;
  if (walletSession) {
    let accountId: string | undefined;
    try {
      const claims = JSON.parse(
        Buffer.from(walletSession.split('.')[1], 'base64').toString('utf8'),
      );
      accountId = claims.account_id;
    } catch {
      throw new NovaProxyAuthError(401, 'Invalid session');
    }
    if (!accountId) {
      throw new NovaProxyAuthError(401, 'Invalid session');
    }
    return { sessionToken: walletSession, accountId };
  }

  // ── Source 2: mint from the Auth0 session ───────────────────────────────
  const origin = new URL(req.url).origin;
  let tokenRes: Response;
  try {
    tokenRes = await fetch(`${origin}/api/auth/session-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: req.headers.get('cookie') ?? '',
      },
      body: '{}',
    });
  } catch {
    throw new NovaProxyAuthError(500, 'Failed to authenticate');
  }

  if (!tokenRes.ok) {
    // Propagate the mint route's status (401 no session, 404 no NOVA account, …)
    // and its error string, so the caller sees the real reason.
    const err = await tokenRes.json().catch(() => ({}));
    throw new NovaProxyAuthError(tokenRes.status, err.error || 'Unauthorized');
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.token || !tokenData.account_id) {
    throw new NovaProxyAuthError(500, 'Failed to authenticate');
  }
  return { sessionToken: tokenData.token, accountId: tokenData.account_id };
}