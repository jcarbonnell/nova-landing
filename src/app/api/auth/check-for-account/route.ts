// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import * as nearAPI from 'near-api-js';

const { providers } = nearAPI;

if (!process.env.NEXT_PUBLIC_RPC_URL) {
  throw new Error('NEXT_PUBLIC_RPC_URL env var missing');
}

if (!process.env.NEXT_PUBLIC_PARENT_DOMAIN) {
  throw new Error('NEXT_PUBLIC_PARENT_DOMAIN env var missing');
}

if (!process.env.NEXT_PUBLIC_SHADE_API_URL) {
  throw new Error('NEXT_PUBLIC_SHADE_API_URL env var missing');
}

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

    const session = await auth0.getSession();

    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    let accountIdToCheck: string | null = null;
    
    if (username) {
      // MODE 1: Check username availability
      const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;
      
      const domainEscaped = parentDomain.replace(/\./g, '\\.');
      const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
      
      if (!regex.test(fullId)) {
        return NextResponse.json(
          { error: `Invalid account ID format` },
          { status: 400 }
        );
      }
      
      accountIdToCheck = fullId;
      console.log('Mode 1: Checking username availability:', accountIdToCheck);
      
    } else {
      // MODE 2: Check if user has account in Shade
      const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL!;
      
      try {
        // ✅ Get REAL JWT token
        const authToken = (session as any).idToken || (session as any).accessToken;
        
        if (!authToken) {
          console.log('No JWT token, assuming no account');
          return NextResponse.json({ exists: false, accountId: null });
        }

        console.log('Mode 2: Querying Shade with real JWT...');
        console.log('Token preview:', authToken.substring(0, 50) + '...');
        
        const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/check`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            email, 
            auth_token: authToken // ✅ Real JWT
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (shadeResponse.ok) {
          const shadeData = await shadeResponse.json();
          
          if (shadeData.exists && shadeData.account_id) {
            accountIdToCheck = shadeData.account_id;
            console.log('✅ Found account in Shade:', accountIdToCheck);
          } else {
            return NextResponse.json({ exists: false, accountId: null });
          }
        } else if (shadeResponse.status === 404) {
          console.log('User not found in Shade (new user)');
          return NextResponse.json({ exists: false, accountId: null });
        } else {
          const errorText = await shadeResponse.text();
          console.error('Shade API error:', {
            status: shadeResponse.status,
            error: errorText.substring(0, 200),
          });
          return NextResponse.json({ exists: false, accountId: null });
        }
      } catch (shadeError) {
        console.error('Shade check error:', shadeError);
        return NextResponse.json({ exists: false, accountId: null });
      }
    }

    // Verify on NEAR blockchain
    if (!accountIdToCheck) {
      return NextResponse.json({ exists: false, accountId: null });
    }

    console.log('Verifying on blockchain:', accountIdToCheck);

    const provider = new providers.JsonRpcProvider({ 
      url: process.env.NEXT_PUBLIC_RPC_URL! 
    });

    try {
      const rawResponse = await provider.query({
        request_type: 'view_account',
        finality: 'final',
        account_id: accountIdToCheck,
      });

      const response = rawResponse as unknown as ViewAccountResponse;
      const exists = response.result.code_hash !== null && response.result.storage_paid !== null;

      console.log('Blockchain verification:', { accountId: accountIdToCheck, exists });

      return NextResponse.json({ 
        exists, 
        accountId: exists ? accountIdToCheck : null 
      });
      
    } catch (rpcError) {
      console.log(`Account ${accountIdToCheck} not found on blockchain`);
      return NextResponse.json({ exists: false, accountId: null });
    }
    
  } catch (error) {
    console.error('❌ Check account error:', error);
    return NextResponse.json({ 
      error: 'Server error during account check',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}