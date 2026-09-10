// nova-landing/src/app/api/auth/dashboard-logout/route.ts
//
// Sign-out for the /app dashboard. The dashboard authenticates wallet users via
// the httpOnly `nova_session` cookie (set by wallet-verify), which the /app gate
// checks FIRST. Auth0's /auth/logout does NOT clear that cookie, so signing out
// via Auth0 alone left a valid wallet session behind — and because the gate is
// cookie-first, that stale wallet cookie SHADOWED a subsequent email login
// (you'd land back in the wallet session at /app). This route closes that gap by
// clearing `nova_session` server-side (it is httpOnly — only a server route can
// delete it), then routing by user kind:
//
//   • Wallet user (no email): clear the cookie → redirect to /. No Auth0 session
//     exists, so we must NOT hit /auth/logout — doing so fires a spurious Auth0
//     "log out?" prompt for a self-sovereign user.
//   • Email user (has email): clear the cookie (in case one lingers) → /auth/logout
//     so Auth0 tears down the appSession too.
//
// GET (not POST): the shell navigates here with window.location, and a full
// navigation is what lets /auth/logout take over the document for the email case.
// `kind` is a hint for the redirect target only — it grants nothing and reveals
// nothing (clearing a cookie and choosing a redirect are not privileged), so it
// needs no auth. The cookie is always cleared regardless of `kind`.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const kind = new URL(req.url).searchParams.get('kind');

  // Email users go through Auth0 logout (clears appSession); wallet users just
  // return to / (no Auth0 session to clear, no popup).
  const target = kind === 'email' ? '/auth/logout' : '/';
  const res = NextResponse.redirect(new URL(target, req.url));

  // Delete the httpOnly nova_session. Must match the attributes wallet-verify
  // set it with (path:'/') for the delete to take. maxAge:0 expires it now.
  res.cookies.set('nova_session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return res;
}