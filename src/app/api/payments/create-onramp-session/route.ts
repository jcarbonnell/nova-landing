// src/app/api/payments/create-onramp-session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, isWalletOnlyUser } from '@/lib/auth0';

// Stripe secret key for server-side API calls
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export async function POST(req: NextRequest) {
  try {
    const { accountId, email, amount } = await req.json();

    // Check if testnet - reject immediately
    const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK !== 'mainnet';
    if (isTestnet) {
      return NextResponse.json({ 
        error: 'Payment not available on testnet. Please skip funding to create a free testnet account.' 
      }, { status: 400 });
    }

    // Validate user - either Auth0 session OR wallet user
    const isWalletUser = isWalletOnlyUser(req);
    
    if (isWalletUser) {
      // For wallet users, validate via wallet_id header or accountId
      const walletId = req.headers.get('x-wallet-id');
      if (!walletId && !accountId) {
        return NextResponse.json({ error: 'Unauthorized - no wallet ID' }, { status: 401 });
      }
      console.log('Wallet user creating onramp session:', walletId || accountId);
    } else {
      // For Auth0 users, validate session
      const session = await auth0.getSession();
      if (!session?.user?.email || session.user.email !== email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const parsedAmount = parseFloat(amount);
    if (!accountId || isNaN(parsedAmount) || parsedAmount < 5) {
      return NextResponse.json({ 
        error: 'Invalid accountId or amount (min $5 USD)' 
      }, { status: 400 });
    }

    // always mainnet for real payments
    const network = 'mainnet';

    console.log('Creating Onramp session:', { 
      accountId, 
      email, 
      amount: parsedAmount, 
      network,
      isWalletUser,
    });

    // Create onramp session via Stripe REST API
    const response = await fetch('https://api.stripe.com/v1/crypto/onramp_sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        // Source: What the user pays (USD)
        'transaction_details[source_currency]': 'usd',
        'transaction_details[source_exchange_amount]': String(parsedAmount),

        // Destination: Where the crypto goes
        'transaction_details[destination_currency]': 'near',
        'transaction_details[destination_network]': network,
        
        // Lock destination network (required for NEAR)
        'transaction_details[lock_wallet_address]': 'true',
        
        // Wallet address
        [`wallet_addresses[${network}]`]: accountId, // Use network-specific key
        
        // Customer info
        'customer_information[email]': email || `${accountId}@wallet.near`,
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

        // Log detailed error for debugging
        console.error('Stripe error details:', {
          type: errorData.error?.type,
          code: errorData.error?.code,
          param: errorData.error?.param,
          message: errorData.error?.message,
        });
      } catch {
        errorMessage = errorText.substring(0, 200);
      }
      
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const sessionData = await response.json();

    if (!sessionData.client_secret) {
      console.error('No client_secret in response:', sessionData);
      throw new Error('No client_secret returned from Stripe');
    }

    console.log('Onramp session created:', {
      sessionId: sessionData.id,
      network,
      sourceAmount: parsedAmount,
      status: sessionData.status,
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