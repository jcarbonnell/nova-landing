// nova-landing/src/app/api/auth/session-token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { auth0 } from '@/lib/auth0';
import { log, logError } from '@/lib/log';

const ISSUER = 'https://nova-sdk.com';
const AUDIENCE = 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

// Token validity (24 hours default, configurable)
const TOKEN_EXPIRY = process.env.SESSION_TOKEN_EXPIRY || '24h';

export async function POST(req: NextRequest) {
  try {
    // Check for API key authentication (SDK flow)
    const apiKey = req.headers.get('x-api-key');

    let body: { wallet_id?: string; account_id?: string } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body is OK for email users (they use Auth0 session)
    }

    const { wallet_id, account_id: requestedAccountId } = body;

    let accountId: string | null = null;
    let subject: string;
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    const sessionSecret = process.env.SESSION_TOKEN_SECRET;
    if (!shadeUrl || !sessionSecret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Path 0: API key provided (secure SDK flow)
    if (apiKey && requestedAccountId) {
      // Verify API key with Shade TEE
      const verifyResponse = await fetch(`${shadeUrl}/rpc/user-keys/verify-api-key`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({ api_key: apiKey, account_id: requestedAccountId }),
        signal: AbortSignal.timeout(10000),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json().catch(() => ({}));
        return NextResponse.json(
          { error: errorData.error || 'Invalid API key' },
          { status: 401 }
        );
      }

      const verifyData = await verifyResponse.json();
      if (!verifyData.valid) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
      }

      accountId = verifyData.account_id;
      subject = `apikey|${accountId}`;
      
      log('session_token_apikey', { account_id: accountId });
    }
    // Path 1: account_id provided without API key (INSECURE - reject)
    else if (requestedAccountId && !wallet_id && !apiKey) {
      return NextResponse.json(
        { error: 'API key required. Get yours at nova-sdk.com' },
        { status: 401 }
      );
    }
    // Path 2: wallet_id DISABLED (v0.4). Re-enable in v0.5 as NEP-413 challenge/response
    else if (wallet_id) {
      return NextResponse.json({
        error: 'Wallet auth disabled pending self-custody migration (v0.5)',
        code: 'WALLET_AUTH_PENDING_SELF_CUSTODY',
      }, { status: 501 });
    }

    // Path 3: Email user - verify Auth0 session
    else {
      const session = await auth0.getSession();
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const email = session.user.email;

      // Get Auth0 token for Shade verification
      let authToken: string | null = null;
      try {
        const tokenResponse = await auth0.getAccessToken();
        authToken = tokenResponse?.token || null;
      } catch {
        // Try ID token as fallback
        authToken = typeof session.idToken === 'string' ? session.idToken : null;
      }

      // Lookup NOVA account for this email
      const shadeResponse = await fetch(`${shadeUrl}/rpc/user-keys/check`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({ 
          email,
          auth_token: authToken 
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!shadeResponse.ok) {
        const errorText = await shadeResponse.text();
        logError('session_token_shade_check_failed', {
          status: shadeResponse.status,
          error: errorText.slice(0, 200),
        });
        return NextResponse.json({ 
          error: 'No NOVA account found for this email' 
        }, { status: 404 });
      }

      const shadeData = await shadeResponse.json();
      if (!shadeData.exists || !shadeData.account_id) {
        return NextResponse.json({ 
          error: 'No NOVA account found. Create one at nova-sdk.com first.' 
        }, { status: 404 });
      }

      accountId = shadeData.account_id;
      subject = `email|${email}`;
      
      log('session_token_email', { email, account_id: accountId });
    }

    if (!accountId) {
      return NextResponse.json({ error: 'Could not determine account' }, { status: 400 });
    }

    // Create signed JWT
    const secret = new TextEncoder().encode(sessionSecret);
    
    const token = await new SignJWT({
      account_id: accountId,
      type: 'nova_session',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(TOKEN_EXPIRY)
      .sign(secret);

    log('session_token_issued', { account_id: accountId });

    return NextResponse.json({
      token,
      account_id: accountId,
      expires_in: TOKEN_EXPIRY,
    });

  } catch (error) {
    logError('session_token_error', { message: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Failed to issue session token' }, { status: 500 });
  }
}

// GET endpoint for checking current session
export async function GET() {
  try {
    const session = await auth0.getSession();
    
    if (!session?.user) {
      return NextResponse.json({ 
        authenticated: false,
        message: 'Not logged in. Visit nova-sdk.com to authenticate.'
      });
    }

    return NextResponse.json({
      authenticated: true,
      email: session.user.email,
      message: 'Use POST to get a session token for the SDK.'
    });

  } catch (error) {
    return NextResponse.json({ 
      authenticated: false,
      error: 'Session check failed'
    }, { status: 500 });
  }
}