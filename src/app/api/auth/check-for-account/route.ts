// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken,isWalletOnlyUser } from '@/lib/auth0';
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
    const { username, email, wallet_id } = body;

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL!;

    // Wallet users
    if (wallet_id) {
      console.log('Checking for NOVA account linked to wallet:', wallet_id);

      try {
        const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id }),
          signal: AbortSignal.timeout(10000),
        });

        if (shadeResponse.ok) {
          const shadeData = await shadeResponse.json();
          if (shadeData.exists && shadeData.account_id) {
            console.log('Found NOVA account for wallet:', shadeData.account_id);
            return NextResponse.json({
              exists: true,
              accountId: shadeData.account_id,
              wallet_id: wallet_id,
              accountCheck: true,
            });
          }
        }

        // If wallet user provided username, check blockchain availability
        if (username) {
          const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;
          const domainEscaped = parentDomain.replace(/\./g, '\\.');
          const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
      
          if (!regex.test(fullId)) {
            return NextResponse.json(
              { error: `Invalid account ID format (must end with .${parentDomain})` },
              { status: 400 }
            );
          }

          console.log('Wallet user: checking username on blockchain:', fullId);
          const provider = new JsonRpcProvider({ url: process.env.NEXT_PUBLIC_RPC_URL! });

          try {
            await provider.query({
              request_type: 'view_account',
              finality: 'final',
              account_id: fullId,
            });

            console.log('Username already exists on blockchain');
            return NextResponse.json({ 
              exists: true, 
              accountId: fullId,
              wallet_id: wallet_id,
              accountCheck: true,
            });
          } catch (rpcError) {
            console.log('Username available on blockchain');
            return NextResponse.json({ 
              exists: false, 
              accountId: null,
              wallet_id: wallet_id,
              accountCheck: true,
            });
          }
        }

        // No NOVA account found and no username to check
        console.log('No NOVA account found for wallet:', wallet_id);
        return NextResponse.json({
          exists: false,
          accountId: null,
          wallet_id: wallet_id,
          accountCheck: true,
        });

      } catch (shadeError) {
        console.error('Shade check error for wallet:', shadeError);
        return NextResponse.json({
          exists: false,
          accountId: null,
          wallet_id: wallet_id,
          accountCheck: true,
          warning: 'Shade service error',
        });
      }
    }
    
    // Email users 
    if (!email) {
      return NextResponse.json({ error: 'Email or wallet_id required' }, { status: 400 });
    }

    // Validate Auth0 session
    const session = await auth0.getSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // checking username availability
    if (username) {
      const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;
      
      const domainEscaped = parentDomain.replace(/\./g, '\\.');
      const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
      
      if (!regex.test(fullId)) {
        console.error('Validation failed:', { fullId, pattern: regex.source });
        return NextResponse.json(
          { error: `Invalid account ID format (must end with .${parentDomain})` },
          { status: 400 }
        );
      }
      
      console.log('Checking username availability:', fullId);
      
      const provider = new JsonRpcProvider({ url: process.env.NEXT_PUBLIC_RPC_URL! });

      try {
        await provider.query({
          request_type: 'view_account',
          finality: 'final',
          account_id: fullId,
        });

        console.log('Account verified on blockchain - username taken');
        return NextResponse.json({ 
          exists: true, 
          accountId: fullId,
          accountCheck: true,
        });
      } catch (rpcError) {
        console.log('Account not found on NEAR blockchain - username available');      
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
        });
      }
    }
      
    // checking for existing account in Shade TEE
    const authToken = await getAuthToken();
      
    if (authToken) {
      console.log('Token preview:', authToken.substring(0, 50) + '...');
      try {
        const decoded = jwt.decode(authToken, { complete: true });
        console.log('Token header:', decoded?.header);
        console.log('Token payload keys:', Object.keys(decoded?.payload || {}));
        console.log('Token aud:', (decoded?.payload as any)?.aud);
        console.log('Token iss:', (decoded?.payload as any)?.iss);
      } catch (e) {
        console.log('Token is not a valid JWT');
      }
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
            console.error('Token audience mismatch!', {
              expected: expectedAudience,
              actual: actualAudience,
            });
          } else {
            console.log('Token audience matches Shade expectation');
          }
        } else if (actualAudience !== expectedAudience) {
          console.error('Token audience mismatch!', {
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
      console.warn('No auth token available - Shade check will fail');
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
        signal: AbortSignal.timeout(10000),
      });

      if (shadeResponse.ok) {
        const shadeData = await shadeResponse.json();
          
        if (shadeData.exists && shadeData.account_id) {
          console.log('Found account in Shade TEE:', shadeData.account_id);
          
          // Verify on blockchain
          const provider = new JsonRpcProvider({ url: process.env.NEXT_PUBLIC_RPC_URL! });
          try {
            await provider.query({
              request_type: 'view_account',
              finality: 'final',
              account_id: shadeData.account_id,
            });

            console.log('Account verified on blockchain');
            return NextResponse.json({ 
              exists: true, 
              accountId: shadeData.account_id,
              accountCheck: true,
            });
          } catch (rpcError) {
            console.warn('Account in Shade but not on blockchain');
            return NextResponse.json({ 
              exists: false, 
              accountId: null,
              accountCheck: true,
              warning: 'Account mismatch',
            });
          }
        } else {
          console.log('No account found in Shade');
          return NextResponse.json({ 
            exists: false, 
            accountId: null,
            accountCheck: true,
          });
        }
      } else if (shadeResponse.status === 404) {
        console.log('User not found in Shade (new user)');
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
        });
      } else if (shadeResponse.status === 401 || shadeResponse.status === 403) {
        const errorText = await shadeResponse.text();
        console.error('Shade authentication failed', {
          status: shadeResponse.status,
          error: errorText.substring(0, 200),
          hadToken: !!authToken,
        });
          
        if (authToken) {
          return NextResponse.json({ 
            error: 'Authentication with Shade TEE failed',
            details: 'Token may be invalid or expired',
            accountCheck: false,
          }, { status: 401 });
        }
        
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
          error: errorText.substring(0, 200),
        });
        
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
          warning: 'Shade check failed',
        });
      }
    } catch (shadeError) {
      console.error('Shade check exception:', shadeError);
      return NextResponse.json({ 
        exists: false, 
        accountId: null,
        accountCheck: true,
        warning: 'Shade service unreachable',
      });
    }

  } catch (error) {
    console.error('Check account error:', error);
    return NextResponse.json({ 
      error: 'Server error during account check',
      details: error instanceof Error ? error.message : 'Unknown error',
      accountCheck: false,
    }, { status: 500 });
  }
}