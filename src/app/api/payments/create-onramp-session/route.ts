// src/app/api/payments/create-onramp-session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

// Stripe secret key for server-side API calls
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export async function POST(req: NextRequest) {
  try {
    const { accountId, email, amount } = await req.json();
    
    // Validate session
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

    // Determine network (testnet for now)
    const network = process.env.NEXT_PUBLIC_NEAR_NETWORK === 'mainnet' 
      ? 'near-mainnet' 
      : 'near-testnet';

    console.log('Creating Onramp session:', { 
      accountId, 
      email, 
      amount: parsedAmount, 
      network 
    });

    // Create onramp session via Stripe REST API
    // Docs: https://stripe.com/docs/crypto/onramp
    const response = await fetch('https://api.stripe.com/v1/crypto/onramp_sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'transaction_details[destination_currency]': 'near',
        'transaction_details[destination_network]': network,
        'transaction_details[destination_amount]': String(parsedAmount),
        'wallet_addresses[near]': accountId, // NEAR account to receive funds
        'customer_information[email]': email,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stripe API error:', response.status, errorText);
      
      // Parse Stripe error if JSON
      let errorMessage = 'Failed to create onramp session';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        errorMessage = errorText.substring(0, 200); // Truncate long errors
      }
      
      return NextResponse.json({ 
        error: errorMessage 
      }, { status: response.status });
    }

    const sessionData = await response.json();

    if (!sessionData.client_secret) {
      console.error('No client_secret in response:', sessionData);
      throw new Error('No client_secret returned from Stripe');
    }

    console.log('Onramp session created:', {
      sessionId: sessionData.id,
      network,
      amount: parsedAmount,
    });

    return NextResponse.json({
      clientSecret: sessionData.client_secret,
      sessionId: sessionData.id,
    });
    
  } catch (error: unknown) {
    console.error('Onramp session creation error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to create payment session: ${errMsg}` },
      { status: 500 }
    );
  }
}
