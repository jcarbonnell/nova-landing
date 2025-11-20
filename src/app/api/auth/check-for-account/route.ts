// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { JsonRpcProvider } from '@near-js/providers';

if (!process.env.NEXT_PUBLIC_RPC_URL) {
  throw new Error('NEXT_PUBLIC_RPC_URL env var missing');
}

if (!process.env.NEXT_PUBLIC_PARENT_DOMAIN) {
  throw new Error('NEXT_PUBLIC_PARENT_DOMAIN env var missing');
}

if (!process.env.NEXT_PUBLIC_SHADE_API_URL) {
  throw new Error('NEXT_PUBLIC_SHADE_API_URL env var missing');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, email } = body;
    
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Validate Auth0 session
    const session = await auth0.getSession();

    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    let accountIdToCheck: string | null = null;
    
    if (username) {
      // ==========================================
      // MODE 1: Check specific username availability
      // (Called from CreateAccountModal when user types username)
      // ==========================================
      
      // Construct full account ID from username
      const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;
      
      // Validate format (e.g., jcarbonnell.nova-sdk-5.testnet)
      const domainEscaped = parentDomain.replace(/\./g, '\\.');
      const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
      
      if (!regex.test(fullId)) {
        console.error('Validation failed:', { fullId, pattern: regex.source });
        return NextResponse.json(
          { error: `Invalid account ID format (must end with .${parentDomain})` },
          { status: 400 }
        );
      }
      
      accountIdToCheck = fullId;
      console.log('Mode 1: Checking username availability:', accountIdToCheck);
      
    } else {
      // ==========================================
      // MODE 2: Check if user has account stored in Shade
      // (Called from HomeClient after Auth0 login to see if account exists)
      // ==========================================
      
      const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL!;
      
      try {
        // Generate auth token (matching create-account implementation)
        const token = session.idToken;
        if (!token) {
          console.log('No ID token in session, assuming no account for:', email);
          return NextResponse.json({ exists: false, accountId: null });
        }
        
        console.log('Mode 2: Querying Shade for user account:', email);
        
        const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/check`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            email, 
            auth_token: token 
          }),
          // Add timeout to prevent hanging
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (shadeResponse.ok) {
          const shadeData = await shadeResponse.json();
          
          if (shadeData.exists && shadeData.account_id) {
            accountIdToCheck = shadeData.account_id;
            console.log('✅ Found account in Shade TEE:', {
              accountId: accountIdToCheck,
              network: shadeData.network,
              publicKey: shadeData.public_key?.substring(0, 20) + '...',
              createdAt: shadeData.created_at,
            });
          } else {
            console.log('No account found in Shade for:', email);
            return NextResponse.json({ 
              exists: false, 
              accountId: null 
            });
          }
        } else if (shadeResponse.status === 404) {
          // 404 means user not found - this is expected for new users
          console.log('User not found in Shade (new user):', email);
          return NextResponse.json({ 
            exists: false, 
            accountId: null 
          });
        } else {
          const errorText = await shadeResponse.text();
          console.error('Shade API error:', {
            status: shadeResponse.status,
            statusText: shadeResponse.statusText,
            error: errorText.substring(0, 200),
          });
          
          // Shade error - assume no account (safe default for new users)
          console.log('Shade error, assuming no account for:', email);
          return NextResponse.json({ 
            exists: false, 
            accountId: null 
          });
        }
      } catch (shadeError) {
        console.error('Shade check error:', shadeError);
        
        // Network error, timeout, or other issue
        if (shadeError instanceof Error) {
          console.error('Shade error details:', {
            message: shadeError.message,
            name: shadeError.name,
          });
        }
        
        // If Shade is unreachable, assume no account (safe default)
        console.log('Shade unreachable, assuming no account for:', email);
        return NextResponse.json({ 
          exists: false, 
          accountId: null 
        });
      }
    }

    // ==========================================
    // Verify account exists on NEAR blockchain
    // (Both modes end up here with accountIdToCheck)
    // ==========================================
    
    if (!accountIdToCheck) {
      console.error('No account ID to check (should not reach here)');
      return NextResponse.json({ 
        exists: false, 
        accountId: null 
      });
    }

    console.log('Verifying account on NEAR blockchain:', accountIdToCheck);

    const provider = new JsonRpcProvider({ 
      url: process.env.NEXT_PUBLIC_RPC_URL! 
    });

    try {
      // Query NEAR RPC to check if account exists
      const account = await provider.query({
        request_type: 'view_account',
        finality: 'final',
        account_id: accountIdToCheck,
      });

      console.log('✅ Account verified on blockchain:', accountIdToCheck);

      return NextResponse.json({ 
        exists: true, 
        accountId: accountIdToCheck 
      });
      
    } catch (rpcError) {
      // Account doesn't exist on-chain (expected for availability checks)
      console.log(`Account ${accountIdToCheck} not found on NEAR blockchain`);
      
      // Log RPC error details for debugging (helps identify network issues)
      if (rpcError instanceof Error) {
        console.log('RPC error details:', {
          message: rpcError.message,
          accountId: accountIdToCheck,
        });
        
        // Check if it's an actual "account not found" vs network error
        if (rpcError.message.includes('does not exist') || 
            rpcError.message.includes('UNKNOWN_ACCOUNT')) {
          console.log('→ Account does not exist (available for registration)');
        } else {
          console.error('→ Unexpected RPC error:', rpcError.message);
        }
      }
      
      return NextResponse.json({ 
        exists: false, 
        accountId: null 
      });
    }
    
  } catch (error) {
    console.error('❌ Check account error:', error);
    
    // Log full error stack for debugging
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return NextResponse.json({ 
      error: 'Server error during account check',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}