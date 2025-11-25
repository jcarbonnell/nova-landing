// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken } from '@/lib/auth0';
import { JsonRpcProvider } from '@near-js/providers';
import jwt from 'jsonwebtoken';

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
      // 1. Check username availability      
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
      console.log('Checking username availability');
      
    } else {
      // 2. Check if user has account stored in Shade      
      const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL!;
      
      // Use helper with fallback strategies
      const authToken = await getAuthToken();
      
      // Inspect token claims
      if (authToken) {
        try {
          interface JwtPayload {
            aud?: string | string[];
            iss?: string;
            sub?: string;
            exp?: number;
            azp?: string;
            email?: string;
            [key: string]: unknown;
          }
          
          const decoded = jwt.decode(authToken, { complete: true }) as { payload?: JwtPayload } | null;
          
          // Check if audience matches Shade expectation
          const expectedAudience = 'https://nova-mcp.fastmcp.app';
          const actualAudience = decoded?.payload?.aud;
          
          if (Array.isArray(actualAudience)) {
            if (!actualAudience.includes(expectedAudience)) {
              console.error('❌ Token audience mismatch!', {
                expected: expectedAudience,
                actual: actualAudience,
              });
            } else {
              console.log('Token audience matches Shade expectation');
            }
          } else if (actualAudience !== expectedAudience) {
            console.error('❌ Token audience mismatch!', {
              expected: expectedAudience,
              actual: actualAudience,
            });
          } else {
            console.log('Token audience matches Shade expectation');
          }
        } catch (decodeError) {
          console.error('JWT decode error:', decodeError);
        }
      } else {
        console.warn('⚠️ No auth token available - Shade check will fail');
      }
      
      console.log('Querying Shade for user account');
      
      try {
        const shadePayload: Record<string, string> = { email };
        if (authToken) {
          shadePayload.auth_token = authToken;
        }
        
        const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/check`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(shadePayload),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (shadeResponse.ok) {
          const shadeData = await shadeResponse.json();
          
          if (shadeData.exists && shadeData.account_id) {
            accountIdToCheck = shadeData.account_id;
            console.log('Found account in Shade TEE');
          } else {
            console.log('No account found in Shade');
            return NextResponse.json({ 
              exists: false, 
              accountId: null,
              accountCheck: true,
            });
          }
        } else if (shadeResponse.status === 404) {
          // 404 means user not found - expected for new users
          console.log('User not found in Shade (new user)');
          return NextResponse.json({ 
            exists: false, 
            accountId: null,
            accountCheck: true,
          });
        } else if (shadeResponse.status === 401 || shadeResponse.status === 403) {
          // Auth error - likely missing or invalid token
          const errorText = await shadeResponse.text();
          console.error('Shade authentication failed', {
            status: shadeResponse.status,
            error: errorText.substring(0, 200),
            hadToken: !!authToken,
          });
          
          // If we had a token and it failed, this is a problem
          if (authToken) {
            return NextResponse.json({ 
              error: 'Authentication with Shade TEE failed',
              details: 'Token may be invalid or expired',
              accountCheck: false,
            }, { status: 401 });
          }
          
          // If no token, assume new user
          console.log('No token available, assuming new user');
          return NextResponse.json({ 
            exists: false, 
            accountId: null,
            accountCheck: true,
            warning: 'No authentication token available',
          });
        } else {
          const errorText = await shadeResponse.text();
          console.error('Shade API error:', {
            status: shadeResponse.status,
            statusText: shadeResponse.statusText,
            error: errorText.substring(0, 200),
            hadToken: !!authToken,
          });
          
          // Shade error - assume no account (safe default)
          return NextResponse.json({ 
            exists: false, 
            accountId: null,
            accountCheck: true,
            warning: 'Shade check failed',
          });
        }
      } catch (shadeError) {
        console.error('❌ Shade check exception:', shadeError);
        
        if (shadeError instanceof Error) {
          console.error('Shade error details:', {
            message: shadeError.message,
            name: shadeError.name,
            hadToken: !!authToken,
          });
        }
        
        // Network error - assume no account
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
          warning: 'Shade service unreachable',
        });
      }
    }
    if (!accountIdToCheck) {
      console.error('❌ No account ID to check (should not reach here)');
      return NextResponse.json({ 
        exists: false, 
        accountId: null,
        accountCheck: true,
      });
    }

    console.log('Verifying account on NEAR blockchain');

    const provider = new JsonRpcProvider({ 
      url: process.env.NEXT_PUBLIC_RPC_URL! 
    });

    try {
      // Query NEAR RPC to check if account exists
      await provider.query({
        request_type: 'view_account',
        finality: 'final',
        account_id: accountIdToCheck,
      });

      console.log('Account verified on blockchain');

      return NextResponse.json({ 
        exists: true, 
        accountId: accountIdToCheck,
        accountCheck: true,
      });
      
    } catch (rpcError) {
      // Account doesn't exist on-chain
      console.log('Account not found on NEAR blockchain');
      
      if (rpcError instanceof Error) {
        console.log('RPC error details:', {
          message: rpcError.message,
          accountId: accountIdToCheck,
        });
        
        if (rpcError.message.includes('does not exist') || 
            rpcError.message.includes('UNKNOWN_ACCOUNT') ||
            rpcError.message.includes("doesn't exist")) {
          console.log('Account does not exist (available for registration)');
        } else {
          console.error('Unexpected RPC error:', rpcError.message);
        }
      }
      
      return NextResponse.json({ 
        exists: false, 
        accountId: null,
        accountCheck: true,
      });
    }
    
  } catch (error) {
    console.error('❌ Check account error:', error);
    
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    
    return NextResponse.json({ 
      error: 'Server error during account check',
      details: error instanceof Error ? error.message : 'Unknown error',
      accountCheck: false,
    }, { status: 500 });
  }
}