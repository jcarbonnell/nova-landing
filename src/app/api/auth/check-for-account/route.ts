// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken } from '@/lib/auth0';
import { JsonRpcProvider } from '@near-js/providers';
import { log, logError } from '@/lib/log';

export async function POST(req: NextRequest) {
  try {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN;
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    if (!rpcUrl || !parentDomain || !shadeUrl) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await req.json();
    const { username, email, wallet_id } = body;

    // Wallet users
    if (wallet_id) {
      log('check_wallet_request', { wallet_id });

      try {
        const shadeResponse = await fetch(`${shadeUrl}/rpc/user-keys/check`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
          },
          body: JSON.stringify({ wallet_id }),
          signal: AbortSignal.timeout(10000),
        });

        if (shadeResponse.ok) {
          const shadeData = await shadeResponse.json();
          if (shadeData.exists && shadeData.account_id) {
            log('check_wallet_account_found', { account_id: shadeData.account_id });
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

          log('check_wallet_username_onchain', { account_id: fullId });
          const provider = new JsonRpcProvider({ url: rpcUrl });

          try {
            await provider.query({
              request_type: 'view_account',
              finality: 'final',
              account_id: fullId,
            });

            return NextResponse.json({ 
              exists: true, 
              accountId: fullId,
              wallet_id: wallet_id,
              accountCheck: true,
            });
          } catch (rpcError) {
            log('check_username_available');
            return NextResponse.json({ 
              exists: false, 
              accountId: null,
              wallet_id: wallet_id,
              accountCheck: true,
            });
          }
        }

        // No NOVA account found and no username to check
        log('check_wallet_no_account', { wallet_id });
        return NextResponse.json({
          exists: false,
          accountId: null,
          wallet_id: wallet_id,
          accountCheck: true,
        });

      } catch (shadeError) {
        logError('check_wallet_shade_error', {
          message: shadeError instanceof Error ? shadeError.message : String(shadeError),
        });
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
        log('check_validation_failed', { account_id: fullId });
        return NextResponse.json(
          { error: `Invalid account ID format (must end with .${parentDomain})` },
          { status: 400 }
        );
      }
      
      log('check_username_onchain', { account_id: fullId });
      
      const provider = new JsonRpcProvider({ url: rpcUrl });

      try {
        await provider.query({
          request_type: 'view_account',
          finality: 'final',
          account_id: fullId,
        });

        log('check_username_taken');
        return NextResponse.json({ 
          exists: true, 
          accountId: fullId,
          accountCheck: true,
        });
      } catch (rpcError) {
        log('check_username_available');      
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
        });
      }
    }
      
    // checking for existing account in Shade TEE
    const authToken = await getAuthToken();
      
    try {
      const shadePayload: Record<string, string> = { email };
      if (authToken) {
        shadePayload.auth_token = authToken;
      }

      log('check_shade_query', { email, has_token: !!authToken });
        
      const shadeResponse = await fetch(`${shadeUrl}/rpc/user-keys/check`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify(shadePayload),
        signal: AbortSignal.timeout(10000),
      });

      if (shadeResponse.ok) {
        const shadeData = await shadeResponse.json();
          
        if (shadeData.exists && shadeData.account_id) {
          log('check_shade_account_found', { account_id: shadeData.account_id });
          
          // Verify on blockchain
          const provider = new JsonRpcProvider({ url: rpcUrl });
          try {
            await provider.query({
              request_type: 'view_account',
              finality: 'final',
              account_id: shadeData.account_id,
            });

            log('check_account_verified_onchain');
            return NextResponse.json({ 
              exists: true, 
              accountId: shadeData.account_id,
              accountCheck: true,
            });
          } catch (rpcError) {
            logError('check_account_shade_onchain_mismatch');
            return NextResponse.json({ 
              exists: false, 
              accountId: null,
              accountCheck: true,
              warning: 'Account mismatch',
            });
          }
        } else {
          log('check_shade_no_account');
          return NextResponse.json({ 
            exists: false, 
            accountId: null,
            accountCheck: true,
          });
        }
      } else if (shadeResponse.status === 404) {
        log('check_shade_new_user');
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
        });
      } else if (shadeResponse.status === 401 || shadeResponse.status === 403) {
        const errorText = await shadeResponse.text();
        logError('check_shade_auth_failed', {
          status: shadeResponse.status,
          error: errorText.slice(0, 200),
          hadToken: !!authToken,
        });
          
        if (authToken) {
          return NextResponse.json({ 
            error: 'Authentication with Shade TEE failed',
            details: 'Token may be invalid or expired',
            accountCheck: false,
          }, { status: 401 });
        }
        
        log('check_no_token_new_user');
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
          warning: 'No authentication token available',
        });
      } else {
        const errorText = await shadeResponse.text();
        logError('check_shade_api_error', {
          status: shadeResponse.status,
          error: errorText.slice(0, 200),
        });
        
        return NextResponse.json({ 
          exists: false, 
          accountId: null,
          accountCheck: true,
          warning: 'Shade check failed',
        });
      }
    } catch (shadeError) {
      logError('check_shade_exception', {
        message: shadeError instanceof Error ? shadeError.message : String(shadeError),
      });
      return NextResponse.json({ 
        exists: false, 
        accountId: null,
        accountCheck: true,
        warning: 'Shade service unreachable',
      });
    }

  } catch (error) {
    logError('check_account_error', { message: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({
      error: 'Server error during account check',
      accountCheck: false,
    }, { status: 500 });
  }
}