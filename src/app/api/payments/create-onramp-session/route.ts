// src/app/api/payments/create-onramp-session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { auth0 } from '@/lib/auth0';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

export async function POST(req: NextRequest) {
  try {
    const { accountId, email, amount } = await req.json();  // amount in USD as string
    
    const session = await auth0.getSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedAmount = parseFloat(amount);
    if (!accountId || isNaN(parsedAmount) || parsedAmount < 5) {
      return NextResponse.json({ 
        error: 'Invalid accountId or amount (min $5 USD)' 
      }, { status: 400 });
    }

    console.log('Creating Stripe Crypto Onramp session:', { 
      accountId, 
      email, 
      amount,
      stripVersion: stripe.VERSION 
    });

    // Check if crypto API exists
    console.log('Stripe crypto API available:', {
      hasCrypto: !!stripe.crypto,
      cryptoKeys: stripe.crypto ? Object.keys(stripe.crypto) : [],
    });

    // Correct API call according to Stripe docs
    const onrampSession = await stripe.crypto.onrampSessions.create({
      transaction_details: {
        destination_currency: 'near',
        destination_network: 'near',
        destination_exchange_amount: amount,
        // Optional: specify wallet address
        wallet_address: accountId,
      },
      customer_ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
    });

    console.log('Onramp session created successfully:', {
      id: onrampSession.id,
      status: onrampSession.status,
    });

    return NextResponse.json({
      clientSecret: onrampSession.client_secret,
      sessionId: onrampSession.id,
    });

  } catch (error: any) {
    console.error('Detailed Onramp error:', {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      raw: error.raw,
    });

    // Check if it's an API key issue
    if (error.type === 'StripeAuthenticationError') {
      return NextResponse.json({ 
        error: 'Stripe authentication failed. Check your API keys.',
        hint: 'Verify STRIPE_SECRET_KEY in Vercel environment variables'
      }, { status: 500 });
    }

    // Check if crypto onramp is not enabled
    if (error.message?.includes('not found') || error.code === 'resource_missing') {
      return NextResponse.json({ 
        error: 'Crypto Onramp not enabled for this Stripe account',
        hint: 'Contact Stripe support or visit https://dashboard.stripe.com/settings/crypto',
        canSkip: true
      }, { status: 500 });
    }

    return NextResponse.json(
      { 
        error: error.message || 'Failed to create onramp session',
        details: error.type || 'unknown',
        canSkip: true
      },
      { status: 500 }
    );
  }
}