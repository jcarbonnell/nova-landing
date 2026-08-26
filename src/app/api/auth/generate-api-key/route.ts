// src/app/api/auth/generate-api-key/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken } from '@/lib/auth0';
import { log, logError } from '@/lib/log';

export async function POST(req: NextRequest) {
  try {
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    if (!shadeUrl) {
      return NextResponse.json({ error: 'Shade URL not configured' }, { status: 500 });
    }

    // Parse request body
    let body: { account_id?: string } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body is OK for email users
    }

    // Discriminate on AUTH0 SESSION, not on cookie presence. An email user may
    // carry a stale/empty nova_session cookie from a prior chat session; keying
    // off the cookie sent them down the wallet path with an empty session_token,
    // which Shade rejected as MISSING_FIELDS. The authoritative signal is: does
    // an Auth0 session exist? If yes → email (custodial). If no but a wallet
    // nova_session cookie exists → wallet (SIWN). Otherwise unauthenticated.
    const session = await auth0.getSession();

    let shadeBody: Record<string, string>;

    if (session?.user?.email) {
      // Email path (Auth0). Unchanged from the original route.
      const email = session.user.email;
      const authToken = await getAuthToken();
      if (!authToken) {
        return NextResponse.json(
          { error: 'No authentication token available' },
          { status: 401 }
        );
      }
      log('generate_api_key_request', { email });
      shadeBody = { email, auth_token: authToken };
    } else {
      // Wallet path (SIWN): no Auth0 session, but a nova_session cookie. Forward
      // it as session_token; Shade verifies (verifyNovaSession) and requires
      // sub=wallet|…. A missing/empty cookie → the guard below → 401.
      const walletSession = req.cookies.get('nova_session')?.value;
      if (!walletSession) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      log('generate_api_key_request', { auth: 'wallet_session' });
      shadeBody = { session_token: walletSession };
    }

    const shadeResponse = await fetch(`${shadeUrl}/rpc/user-keys/generate-api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
      },
      body: JSON.stringify(shadeBody),
      signal: AbortSignal.timeout(15000),
    });

    if (!shadeResponse.ok) {
      const errorText = await shadeResponse.text();
      logError('generate_api_key_shade_failed', {
        status: shadeResponse.status,
        error: errorText.slice(0, 200),
      });
      return NextResponse.json(
        { error: 'Failed to generate API key' },
        { status: shadeResponse.status }
      );
    }

    const data = await shadeResponse.json();
    log('generate_api_key_issued', { account_id: data.account_id });

    return NextResponse.json({
      success: true,
      api_key: data.api_key,
      account_id: data.account_id,
      message: data.message,
    });

  } catch (error) {
    logError('generate_api_key_error', { message: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 });
  }
}