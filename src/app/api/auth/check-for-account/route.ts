// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

// Validate env vars
if (!process.env.NEXT_PUBLIC_RPC_URL) {
  throw new Error('NEXT_PUBLIC_RPC_URL env var missing—add to .env.local (e.g., https://rpc.testnet.near.org)');
}

if (!process.env.NEXT_PUBLIC_PARENT_DOMAIN) {
  throw new Error('NEXT_PUBLIC_PARENT_DOMAIN env var missing (e.g., nova-sdk-5.testnet)');
}

// Full response shape from near-api-js (for view_account)
interface ViewAccountResponse {
  kind: 'ViewAccount';
  result: {
    code_hash: string | null;
    storage_paid: { total: string; owned: number; storage_byte_cost: string; } | null;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, email } = body;
    
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Get session from Auth0 middleware
    const session = await auth0.getSession();

    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    
    // Two modes:
    // 1. If username provided: Check if that specific account exists (for availability check)
    // 2. If no username: Check if user has any account linked to their session
    
    let accountIdToCheck: string | null = null;
    
    if (username) {
      // Mode 1: Check specific username availability
      const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;
      
      // Validate format
      const domainEscaped = parentDomain.replace(/\./g, '\\.');
      const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
      if (!regex.test(fullId)) {
        return NextResponse.json(
          { error: `Invalid account ID format (must end with .${parentDomain})` },
          { status: 400 }
        );
      }
      
      accountIdToCheck = fullId;
    } else {
      // Mode 2: Check if user has account stored in their Auth0 profile
      const storedAccountId = session.user.near_account_id as string | undefined;
      if (!storedAccountId) {
        // No account stored in profile
        console.log(`No NEAR account stored for ${email}`);
        return NextResponse.json({ exists: false, accountId: null });
      }
      accountIdToCheck = storedAccountId;
    }

    // Query NEAR RPC to check if account exists on-chain
    const near = await import('near-api-js');
    const { JsonRpcProvider } = near.providers;
    const provider = new JsonRpcProvider({ url: process.env.NEXT_PUBLIC_RPC_URL! });

    try {
      const rawResponse = await provider.query({
        request_type: 'view_account',
        finality: 'final',
        account_id: accountIdToCheck,
      });

      const response = rawResponse as unknown as ViewAccountResponse;
      const exists = response.result.code_hash !== null && response.result.storage_paid !== null;

      if (username) {
        // Mode 1: Return availability status
        console.log(`Username check: ${accountIdToCheck} - exists: ${exists}`);
        return NextResponse.json({ 
          exists, 
          accountId: exists ? accountIdToCheck : null 
        });
      } else {
        // Mode 2: Return user's account status
        if (exists) {
          console.log(`User ${email} has existing account: ${accountIdToCheck}`);
          return NextResponse.json({ 
            exists: true, 
            accountId: accountIdToCheck 
          });
        } else {
          console.log(`Stored account ${accountIdToCheck} not found on-chain for ${email}`);
          return NextResponse.json({ 
            exists: false, 
            accountId: null 
          });
        }
      }
    } catch (error) {
      // Account doesn't exist on-chain (RPC error)
      console.log(`Account ${accountIdToCheck} not found on NEAR: ${error}`);
      return NextResponse.json({ 
        exists: false, 
        accountId: null 
      });
    }
    
  } catch (error) {
    console.error('Check account error:', error);
    return NextResponse.json({ 
      error: 'Server error during check',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}