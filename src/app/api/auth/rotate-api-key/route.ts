// src/app/api/auth/rotate-api-key/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken } from '@/lib/auth0';
import { log, logError } from '@/lib/log';
import { configOrNull, shadeApiUrl } from '@/lib/server-config';

export async function POST(req: NextRequest) {
  try {
    const shadeUrl = configOrNull(shadeApiUrl);
    if (!shadeUrl) {
      return NextResponse.json({ error: 'Shade URL not configured' }, { status: 500 });
    }

    // Parse body (account_id path is disabled, same as generate)
    let body: { account_id?: string } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch {
      // empty body OK for email users
    }

    if (body.account_id) {
      return NextResponse.json({
        error: 'Wallet auth disabled pending self-custody migration (v0.5)',
        code: 'WALLET_AUTH_PENDING_SELF_CUSTODY',
      }, { status: 501 });
    }

    // Same discrimination as generate-api-key: an Auth0 session means the email
    // (custodial) path; otherwise the wallet nova_session cookie (SIWN), which
    // Shade verifies itself (resolveApiKeyTarget → verifyNovaSession, sub=wallet|…).
    const session = await auth0.getSession();

    let shadeBody: Record<string, string>;

    if (session?.user?.email) {
      const email = session.user.email;
      const authToken = await getAuthToken();
      if (!authToken) {
        return NextResponse.json({ error: 'No authentication token available' }, { status: 401 });
      }
      log('rotate_api_key_request', { email });
      shadeBody = { email, auth_token: authToken };
    } else {
      const walletSession = req.cookies.get('nova_session')?.value;
      if (!walletSession) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      log('rotate_api_key_request', { auth: 'wallet_session' });
      shadeBody = { session_token: walletSession };
    }

    const shadeResponse = await fetch(`${shadeUrl}/rpc/user-keys/rotate-api-key`, {
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
      logError('rotate_api_key_shade_failed', {
        status: shadeResponse.status,
        error: errorText.slice(0, 200),
      });
      return NextResponse.json({ error: 'Failed to rotate API key' }, { status: shadeResponse.status });
    }

    const data = await shadeResponse.json();
    log('rotate_api_key_issued', { auth: 'email' in shadeBody ? 'email' : 'wallet_session', account_id: data.account_id });

    return NextResponse.json({
      success: true,
      api_key: data.api_key,
      account_id: data.account_id,
      version: data.version,
      message: data.message,
    });

  } catch (error) {
    logError('rotate_api_key_error', { message: error instanceof Error ? error.message : 'Unknown error' });
    return NextResponse.json({ error: 'Failed to rotate API key' }, { status: 500 });
  }
}