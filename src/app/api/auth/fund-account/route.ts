// src/app/api/auth/fund-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth0';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, amount, accountId } = await req.json();
    const session = await getServerSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!sessionId || !amount || !accountId) {
      return NextResponse.json({ error: 'Missing sessionId, amount, or accountId' }, { status: 400 });
    }

    // Relayer fund (2025 API: confirms Onramp, transfers to subaccount)
    const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL || 'https://relayer.testnet.near.org';
    const response = await fetch(`${relayerUrl}/v1/account/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,  // Stripe Onramp sessionId
        amount_usd: parseFloat(amount),  // For conversion
        account_id: accountId,  // Subaccount to fund
        provider: 'stripe-onramp',  // Ties to payment
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Relayer fund failed: ${response.status}`);
    }

    const { funded_amount_near, tx_hash } = await response.json();
    if (!funded_amount_near) {
      throw new Error('No funded amount returned');
    }

    console.log(`Funded ${accountId}: $${amount} → ${funded_amount_near} NEAR (tx: ${tx_hash})`);

    return NextResponse.json({ fundedAmountNear: funded_amount_near, txHash: tx_hash });
  } catch (error) {
    console.error('Fund account error:', error);
    return NextResponse.json({ error: 'Server error during funding' }, { status: 500 });
  }
}