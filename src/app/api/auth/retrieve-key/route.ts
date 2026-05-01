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
      console.error('No auth token available for key retrieval');
      return NextResponse.json({ 
        error: 'No authentication token available',
        details: 'Session exists but token is missing'
      }, { status: 401 });
    }

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SHADE_API_URL}/api/user-keys/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, auth_token: token, account_id }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Shade retrieve failed: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log('Key retrieved from Shade TEE');

      return NextResponse.json({ private_key: data.private_key });
    } catch (err) {
      console.error('Retrieve key error:', err);
      return NextResponse.json({ 
        error: 'Failed to retrieve key',
        details: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      }, { status: 500 });
    }
  }

  // Wallet users: Retrieve by wallet_id
  else if (wallet_id) {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SHADE_API_URL}/api/user-keys/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id, wallet_id }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Shade retrieve failed');
        return NextResponse.json({ error: 'Key not found' }, { status: 404 });
      }

      const data = await res.json();
      console.log('Key retrieved from Shade TEE');

      return NextResponse.json({ private_key: data.private_key });
    } catch (err) {
      console.error('Retrieve key error:', err);
      return NextResponse.json({ 
        error: 'Failed to retrieve key',
        details: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined
      }, { status: 500 });
    }
  }

  // No email or wallet_id provided
  return NextResponse.json({ error: 'Email or account_id required' }, { status: 400 });
}