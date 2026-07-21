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

    const { account_id } = body;

    // Path 1: account_id — DISABLED (v0.4)
    if (account_id) {
      return NextResponse.json({
        error: 'Wallet auth disabled pending self-custody migration (v0.5)',
        code: 'WALLET_AUTH_PENDING_SELF_CUSTODY',
      }, { status: 501 });
    }

    // Path 2: Email user (use Auth0 session)
    const session = await auth0.getSession();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const email = session.user.email;
    const authToken = await getAuthToken();

    if (!authToken) {
      return NextResponse.json(
        { error: 'No authentication token available' },
        { status: 401 }
      );
    }

    log('generate_api_key_request', { email });

    const shadeResponse = await fetch(`${shadeUrl}/rpc/user-keys/generate-api-key`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
      },
      body: JSON.stringify({ email, auth_token: authToken }),
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
    log('generate_api_key_issued', { email, account_id: data.account_id });

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