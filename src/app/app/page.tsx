// nova-landing/src/app/app/page.tsx
//
// Phase 1 (file-viewer dashboard, roadmap §6.4) — the /app gate.
//
// A SERVER component that establishes identity BEFORE any UI renders, so an
// unauthenticated request never receives dashboard HTML (the security invariant:
// unauth → clean redirect, never a broken screen or a flash of shell). Mirrors
// the root page.tsx's server-session idiom (getServerSession + force-dynamic +
// nodejs runtime); it does NOT render HomeClient, so HomeClient's client-side
// callback/reload effects never run here — /app is a self-contained sibling
// route, per the §5.13/§D1 "do not deepen HomeClient" constraint.
//
// Three outcomes, resolved server-side:
//   1. No Auth0 session          → redirect to login (returnTo=/app; falls back
//                                   to / cleanly if the SDK doesn't honour it).
//   2. Auth0 session, NO NOVA a/c → redirect to / (HomeClient owns account
//                                   creation; the viewer-only dashboard must not
//                                   duplicate that flow).
//   3. Auth0 session + NOVA a/c   → render DashboardShell with { email, accountId }.
//
// accountId is resolved the SAME way session-token/route.ts Path 3 does: POST to
// Shade /rpc/user-keys/check with the email + Auth0 token, behind the internal
// gate. The browser is never told the token; identity is server-resolved and
// passed as props (same shape as root page.tsx handing HomeClient `serverUser`).

import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth0';
import DashboardShell from '../DashboardShell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function resolveNovaAccountId(
  email: string,
  authToken: string | null,
): Promise<string | null> {
  const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (!shadeUrl || !internalSecret) {
    // Misconfiguration is not an auth outcome — surface it as a thrown error so
    // the route's error boundary shows a real message instead of silently
    // treating the user as account-less and bouncing them to /.
    throw new Error('Server configuration error: Shade URL or internal secret missing');
  }

  const res = await fetch(`${shadeUrl}/rpc/user-keys/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalSecret,
    },
    body: JSON.stringify({ email, auth_token: authToken }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });

  if (!res.ok) {
    // A check failure (Shade down, 5xx) is not "no account" — don't misclassify
    // it as outcome 2. Throw so it hits the error boundary rather than bouncing.
    throw new Error(`Account check failed: ${res.status}`);
  }

  const data = await res.json();
  return data?.exists && data?.account_id ? (data.account_id as string) : null;
}

export default async function AppPage() {
  const session = await getServerSession();

  // Outcome 1 — no Auth0 session. best-effort returnTo=/app; if the SDK's
  // allow-list drops it, the user lands authed on / and navigates back — no
  // broken screen either way. The invariant we control is the SEND target.
  if (!session?.user?.email) {
    redirect('/auth/login?returnTo=/app');
  }

  const email = session.user.email;
  // getServerSession flattens idToken/accessToken onto the session; prefer the
  // access token (correct Shade audience), fall back to id token — same order
  // session-token/route.ts uses.
  const authToken =
    (typeof session.accessToken === 'string' ? session.accessToken : null) ??
    (typeof session.idToken === 'string' ? session.idToken : null);

  const accountId = await resolveNovaAccountId(email, authToken);

  // Outcome 2 — authed but no NOVA account. The dashboard is viewer-only and
  // cannot create accounts; / owns that flow (HomeClient → CreateAccountModal).
  if (!accountId) {
    redirect('/');
  }

  // Outcome 3 — authed + has a NOVA account. Identity resolved server-side and
  // handed down as props; the browser never receives a token here.
  return <DashboardShell email={email} accountId={accountId} />;
}