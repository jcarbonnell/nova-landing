// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

if (!process.env.NEXT_PUBLIC_RELAYER_URL) {
  throw new Error('NEXT_PUBLIC_RELAYER_URL is required');
}
if (!process.env.NEXT_PUBLIC_PARENT_DOMAIN) {
  throw new Error('NEXT_PUBLIC_PARENT_DOMAIN is required');
}

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await auth0.getSession();
    
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;

    const domainEscaped = parentDomain.replace('.', '\\.');
    const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
    if (!regex.test(fullId)) {
      return NextResponse.json(
        { error: `Invalid account ID format (must end with .${parentDomain})` },
        { status: 400 }
      );
    }

    const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL!;
    if (!relayerUrl) throw new Error('NEXT_PUBLIC_RELAYER_URL is required');
    const response = await fetch(`${relayerUrl}/v1/account/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: fullId,
        email,
        provider: 'auth0',
        implicit_account: parentDomain.split('.').slice(-2).join('.'),
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

    console.log(`Created subaccount: ${createdId} for ${email}`);
    return NextResponse.json({ accountId: createdId, publicKey: public_key });
  } catch (error) {
    console.error('Create account error:', error);
    return NextResponse.json({ error: 'Server error during creation' }, { status: 500 });
  }
}