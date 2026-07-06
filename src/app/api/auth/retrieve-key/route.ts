// src/app/api/auth/retrieve-key/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken, isWalletOnlyUser } from '@/lib/auth0';

export async function POST(req: NextRequest) {
  const { email, account_id, wallet_id } = await req.json();

  // Email users: Retrieve by email with auth_token
  if (email) {
    const session = await auth0.getSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = await getAuthToken();
    if (!token) {
      return NextResponse.json({ 
        error: 'No authentication token available',
      }, { status: 401 });
    }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SHADE_API_URL}/api/user-keys/retrieve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({ email, auth_token: token, account_id }),
      });

      if (!res.ok) {
        throw new Error('Shade retrieve failed');
      }

      const data = await res.json();
      return NextResponse.json({ private_key: data.private_key });
    } catch (err) {
      return NextResponse.json({ 
        error: 'Failed to retrieve key',
      }, { status: 500 });
    }
  }

  // Wallet users: DISABLED in v0.3.2.
  // The wallet retrieve path accepted an unauthenticated wallet_id assertion —
  // anyone knowing an on-chain account ID could retrieve that account's key.
  // These accounts are currently custodial (NOVA holds the key). Rather than
  // ship a cryptographically circular possession-proof, the path is disabled
  // until v0.5 rebuilds wallet accounts as genuinely self-custodial (user brings
  // their own NEAR wallet; NOVA never holds the key; NEP-413 challenge/response).
  // Email login (Auth0-verified) is unaffected.
  else if (wallet_id) {
    return NextResponse.json(
      {
        error: 'Wallet login is temporarily unavailable',
        detail: 'Wallet-based access is being migrated to self-custody and will return in a future release. Please use email login.',
        code: 'WALLET_AUTH_PENDING_SELF_CUSTODY',
      },
      { status: 501 }
    );
  }

  // No email or wallet_id provided
  return NextResponse.json({ error: 'Email or account_id required' }, { status: 400 });
}