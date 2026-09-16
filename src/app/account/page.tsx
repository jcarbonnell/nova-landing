// src/app/app/account/page.tsx
//
// §8 step 2a — the Account section route. Orphan for now (no nav until step 3);
// reachable by visiting /app/account directly. Gate is COPIED from
// app/page.tsx verbatim (the copy-now-factor-later call — step 3 factors all
// three routes' gates onto one helper). Renders AccountControls inside the
// shared DashboardChrome. AccountControls is still hardcoded-purple here; 2c
// themes it and applies the §4.1 redesign.

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getServerSession } from '@/lib/auth0';
import { verifyNovaSession } from '@/lib/session';
import DashboardChrome from '../DashboardChrome';
import AccountControls from '@/components/AccountControls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function emailFromSubject(subject: string): string {
  return subject.startsWith('email|') ? subject.slice('email|'.length) : '';
}

export default async function AccountPage() {
  const cookieStore = await cookies();
  const novaSession = cookieStore.get('nova_session')?.value;
  if (novaSession) {
    try {
      const claims = await verifyNovaSession(novaSession);
      return (
        <DashboardChrome
          email={emailFromSubject(claims.subject)}
          accountId={claims.account_id}
        >
          <h1 className="font-museo text-2xl md:text-3xl font-black text-nova-text mb-2 tracking-tight">
            Account
          </h1>
          <p className="font-space text-nova-text-dim mb-8">
            Manage your API key and NEAR credits.
          </p>
          <AccountControls accountId={claims.account_id} />
        </DashboardChrome>
      );
    } catch {
      // Stale/invalid session cookie — fall through to Auth0.
    }
  }

  const session = await getServerSession();
  if (!session?.user?.email) {
    redirect('/');
  }

  const email = session.user.email;
  const authToken =
    (typeof session.accessToken === 'string' ? session.accessToken : null) ??
    (typeof session.idToken === 'string' ? session.idToken : null);

  const accountId = await resolveNovaAccountId(email, authToken);
  if (!accountId) {
    redirect('/');
  }

  return (
    <DashboardChrome email={email} accountId={accountId}>
      <h1 className="font-museo text-2xl md:text-3xl font-black text-nova-text mb-2 tracking-tight">
        Account
      </h1>
      <p className="font-space text-nova-text-dim mb-8">
        Manage your API key and NEAR credits.
      </p>
      <AccountControls accountId={accountId} />
    </DashboardChrome>
  );
}