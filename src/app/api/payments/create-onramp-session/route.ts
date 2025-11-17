// src/app/api/payments/create-onramp-session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getServerSession } from '@/lib/auth0';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover',  // 2025 Onramp supports NEAR direct
});

export async function POST(req: NextRequest) {
  try {
    const { accountId, email, amount } = await req.json();  // amount in USD as string
    const session = await getServerSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedAmount = parseFloat(amount);
    if (!accountId || isNaN(parsedAmount) || parsedAmount < 5) {
      return NextResponse.json({ error: 'Invalid accountId or amount (min $5 USD)' }, { status: 400 });
    }

    // Network: Env-based
    const network = process.env.NODE_ENV === 'production' ? 'near-mainnet' : 'near-testnet';

    // Params (typed as any for TS; refine post-types)
    const onrampParams = {
      mint_amount: amount,  // USD (auto → NEAR equiv)
      destination_currency: 'near',
      destination_network: network,
      destination_address: accountId,  // Subaccount
      customer_email: email,  // KYC
    };

    // @ts-expect-error - Stripe types lag for 2025 Onramp; runtime works
    const sessionData = await stripe.crypto.onrampSessions.create(onrampParams);

    if (!sessionData.client_secret) {
      throw new Error('No client_secret returned from Stripe');
    }

    console.log(`Onramp session created for ${accountId}: $${amount} USD → NEAR (${network})`);

    return NextResponse.json({
      clientSecret: sessionData.client_secret,
      sessionId: sessionData.id,
    });
  } catch (error: unknown) {
    console.error('Onramp session creation error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: errMsg || 'Server error creating Onramp session' },
      { status: 500 }
    );
  }
}