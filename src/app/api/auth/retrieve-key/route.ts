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

  // Wallet users: Retrieve by wallet_id
  else if (wallet_id) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SHADE_API_URL}/api/user-keys/retrieve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({ account_id, wallet_id }),
      });

      if (!res.ok) {
        return NextResponse.json({ error: 'Key not found' }, { status: 404 });
      }

      const data = await res.json();
      return NextResponse.json({ private_key: data.private_key });
    } catch (err) {
      return NextResponse.json({ 
        error: 'Failed to retrieve key',
      }, { status: 500 });
    }
  }

  // No email or wallet_id provided
  return NextResponse.json({ error: 'Email or account_id required' }, { status: 400 });
}