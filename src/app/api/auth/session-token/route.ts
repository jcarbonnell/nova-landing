// nova-landing/src/app/api/auth/session-token/route.ts
//
// Issues a signed JWT session token for authenticated users.
// This token is used by nova-sdk-js and nova-sdk-rs to authenticate with the MCP server.
//
// Flow:
// 1. User logs in at nova-sdk.com (Auth0 or wallet)
// 2. Frontend calls this endpoint to get a session token
// 3. User passes token to SDK: new NovaSdk(accountId, { sessionToken })
// 4. MCP server verifies token and checks accountId matches

import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { auth0 } from '@/lib/auth0';

// Secret for signing session tokens - must match MCP server's verification key
const SESSION_TOKEN_SECRET = process.env.SESSION_TOKEN_SECRET;
if (!SESSION_TOKEN_SECRET) {
  throw new Error('SESSION_TOKEN_SECRET env var required');
}

const ISSUER = 'https://nova-sdk.com';
const AUDIENCE = 'https://nova-mcp.fastmcp.app';

// Token validity (24 hours default, configurable)
const TOKEN_EXPIRY = process.env.SESSION_TOKEN_EXPIRY || '24h';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet_id } = body;

    let accountId: string | null = null;
    let subject: string;

    // Path 1: Wallet user - verify wallet_id and lookup accountId from Shade
    if (wallet_id) {
      const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
      if (!shadeUrl) {
        return NextResponse.json({ error: 'Shade URL not configured' }, { status: 500 });
      }

      // Lookup NOVA account for this wallet
      const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id }),
        signal: AbortSignal.timeout(10000),
      });

      if (!shadeResponse.ok) {
        return NextResponse.json({ 
          error: 'No NOVA account found for this wallet' 
        }, { status: 404 });
      }

      const shadeData = await shadeResponse.json();
      if (!shadeData.exists || !shadeData.account_id) {
        return NextResponse.json({ 
          error: 'No NOVA account found. Create one at nova-sdk.com first.' 
        }, { status: 404 });
      }

      accountId = shadeData.account_id;
      subject = `wallet|${wallet_id}`;
      
      console.log('Issuing session token for wallet user:', wallet_id, '->', accountId);
    } 
    // Path 2: Email user - verify Auth0 session
    else {
      const session = await auth0.getSession();
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const email = session.user.email;
      const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
      
      if (!shadeUrl) {
        return NextResponse.json({ error: 'Shade URL not configured' }, { status: 500 });
      }

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
      const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email,
          auth_token: authToken 
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!shadeResponse.ok) {
        const errorText = await shadeResponse.text();
        console.error('Shade check failed:', shadeResponse.status, errorText);
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
      
      console.log('Issuing session token for email user:', email, '->', accountId);
    }

    if (!accountId) {
      return NextResponse.json({ error: 'Could not determine account' }, { status: 400 });
    }

    // Create signed JWT
    const secret = new TextEncoder().encode(SESSION_TOKEN_SECRET);
    
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

    console.log('Session token issued for:', accountId);

    return NextResponse.json({
      token,
      account_id: accountId,
      expires_in: TOKEN_EXPIRY,
    });

  } catch (error) {
    console.error('Session token error:', error);
    return NextResponse.json({ 
      error: 'Failed to issue session token',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
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