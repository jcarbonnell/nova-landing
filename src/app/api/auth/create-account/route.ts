// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth0';

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await getServerSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fullId = username.includes('.') ? username : `${username}.nova-sdk.near`;
    if (!/^[a-z0-9_-]{2,64}\.(nova-sdk\.near|testnet|mainnet)$/.test(fullId)) {
      return NextResponse.json({ error: 'Invalid account ID format (e.g., user.nova-sdk.near)' }, { status: 400 });
    }

    // Relayer call for subaccount creation (2025 API: abstracts CreateAccount action)
    const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL || 'https://relayer.testnet.near.org';
    const response = await fetch(`${relayerUrl}/v1/account/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: fullId,
        email,
        provider: 'auth0',  // Ties to Auth0 claims
        implicit_account: 'nova-sdk.near',  // Ensures subaccount under nova-sdk.near
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Relayer failed: ${response.status}`);
    }

    const { account_id: createdId, public_key } = await response.json();
    if (!createdId) {
      throw new Error('No account_id returned from relayer');
    }

    // Optional: Update session.user.near_account_id (client refetch for now)
    console.log(`Created subaccount: ${createdId} for ${email}`);

    return NextResponse.json({ accountId: createdId, publicKey: public_key });
  } catch (error) {
    console.error('Create account error:', error);
    return NextResponse.json({ error: 'Server error during creation' }, { status: 500 });
  }
}