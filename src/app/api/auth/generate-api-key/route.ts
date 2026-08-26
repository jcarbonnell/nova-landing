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

    // Two authenticated identities resolve to the SAME Shade endpoint, which
    // derives the account server-side. We never send a client account_id — Shade
    // establishes identity by construction (§5.0):
    //   - Wallet (SIWN): forward the nova_session cookie as `session_token`.
    //     Shade verifies its HMAC (verifyNovaSession) and requires sub=wallet|…
    //     before deriving the key. The frontend does NO crypto and trusts nothing
    //     from the request body — the cookie is a bearer of a Shade-minted proof.
    //   - Email (Auth0): the existing path — verify the Auth0 session, forward
    //     { email, auth_token }; Shade verifies against Auth0's JWKS.
    // The body `account_id` field is intentionally IGNORED (that was the disabled
    // Fix E/F takeover branch; Shade still 501s it if ever sent).
    const walletSession = req.cookies.get('nova_session')?.value;

    let shadeBody: Record<string, string>;

    if (walletSession) {
      // Wallet path — pass the cookie through; Shade owns verification.
      log('generate_api_key_request', { auth: 'wallet_session' });
      shadeBody = { session_token: walletSession };
    } else {
      // Email path — Auth0 session required.
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
      shadeBody = { email, auth_token: authToken };
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