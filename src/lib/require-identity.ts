// nova-landing/src/lib/require-identity.ts
//
// §8 step 3 — the single dual-source /app identity gate, factored out of
// app/page.tsx and app/account/page.tsx (the 2a copy-now-factor-later debt, paid
// before the Files + landing routes make the duplication threefold).
//
// Behaviour is IDENTICAL to the two inline gates it replaces — a pure extraction:
//   1. nova_session cookie present + valid  → { email(from sub), accountId }
//      (self-contained; no Shade round-trip; the self-sovereign wallet path).
//   2. cookie absent/invalid → Auth0 session → resolve accountId via Shade.
//   3. no valid cookie AND no Auth0 email   → redirect('/') (offers both logins).
//   4. Auth0 email but NO NOVA account      → redirect('/') (/ owns creation).
//   5. misconfig / Shade 5xx                → THROW (error boundary, NOT a bounce
//      to / — a check failure is not "no account").
//
// Returns { email, accountId } only on success; on every auth failure it calls
// redirect() (which throws Next's redirect signal and never returns). Callers:
//   const { email, accountId } = await requireNovaIdentity();

import 'server-only';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getServerSession } from '@/lib/auth0';
import { verifyNovaSession } from '@/lib/session';

export interface NovaIdentity {
  email: string;
  accountId: string;
}

// email|… subjects carry an email; wallet|… / apikey|… don't (shell hides the
// empty email line).
function emailFromSubject(subject: string): string {
  return subject.startsWith('email|') ? subject.slice('email|'.length) : '';
}

async function resolveNovaAccountId(
  email: string,
  authToken: string | null,
): Promise<string | null> {
  const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (!shadeUrl || !internalSecret) {
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
    throw new Error(`Account check failed: ${res.status}`);
  }

  const data = await res.json();
  return data?.exists && data?.account_id ? (data.account_id as string) : null;
}

export async function requireNovaIdentity(): Promise<NovaIdentity> {
  // Source 1: nova_session cookie (wallet SIWN + any minted session). First,
  // self-contained; an invalid cookie falls through, not a hard block.
  const cookieStore = await cookies();
  const novaSession = cookieStore.get('nova_session')?.value;
  if (novaSession) {
    try {
      const claims = await verifyNovaSession(novaSession);
      return {
        email: emailFromSubject(claims.subject),
        accountId: claims.account_id,
      };
    } catch {
      // Stale/invalid cookie — fall through to Auth0.
    }
  }

  // Source 2: Auth0 session (email users).
  const session = await getServerSession();
  if (!session?.user?.email) {
    redirect('/'); // offers both email login and wallet SIWN
  }

  const email = session.user.email;
  const authToken =
    (typeof session.accessToken === 'string' ? session.accessToken : null) ??
    (typeof session.idToken === 'string' ? session.idToken : null);

  const accountId = await resolveNovaAccountId(email, authToken);
  if (!accountId) {
    redirect('/'); // / owns account creation (HomeClient → CreateAccountModal)
  }

  return { email, accountId };
}