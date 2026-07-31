// src/app/api/auth/wallet-verify/route.ts
//
// Step 2 of wallet SIWN (§5.11-A): verify the wallet's NEP-413 signature and, on
// success, mint a nova_session — converging the wallet path onto the SAME session
// model email/API-key users use (subject `wallet|<account_id>`).
//
// Thin server-side proxy + mint. The browser posts the wallet's signMessage
// output here; this route forwards to Shade with X-Internal-Auth (never exposed
// to the client), and Shade does the actual cryptographic verification (NEP-413
// + on-chain full-access-key check + nonce replay). On ok, we mint the session
// via the shared helper. NOVA never holds the wallet key — this is self-custody.

import { NextRequest, NextResponse } from 'next/server';
import { mintNovaSession } from '@/lib/session';
import { log, logError } from '@/lib/log';

interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string;
  state?: string;
}

export async function POST(req: NextRequest) {
  try {
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    const internalSecret = process.env.INTERNAL_API_SECRET;
    const sessionSecret = process.env.SESSION_TOKEN_SECRET;
    if (!shadeUrl || !internalSecret || !sessionSecret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    let body: {
      signed_message?: SignedMessage;
      message?: string;
      nonce?: string;
    } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { signed_message, message, nonce } = body;
    if (!signed_message || !message || !nonce) {
      return NextResponse.json(
        { error: 'Missing signed_message, message, or nonce' },
        { status: 400 },
      );
    }

    // Forward to Shade for cryptographic verification. Shade owns:
    //   - NEP-413 signature check (recipient = nova-sdk.com),
    //   - on-chain full-access-key check (the account really owns the key),
    //   - nonce validity/replay/expiry (server-issued, single-use).
    const shadeResponse = await fetch(`${shadeUrl}/rpc/wallet/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalSecret,
      },
      body: JSON.stringify({ signed_message, message, nonce }),
      signal: AbortSignal.timeout(10000),
    });

    if (!shadeResponse.ok) {
      // Shade returns { error, code } with code ∈ {UNAUTHORIZED,
      // UNAUTHORIZED_NONCE_REPLAY, VALIDATION_FAILED, FORBIDDEN}. Propagate the
      // string error and a 401 for the auth failures; anything else is upstream.
      const errorData = await shadeResponse.json().catch(() => ({}));
      const status = shadeResponse.status === 401 ? 401 : shadeResponse.status;
      logError('wallet_verify_rejected', {
        status: shadeResponse.status,
        code: typeof errorData.code === 'string' ? errorData.code : undefined,
      });
      return NextResponse.json(
        { error: errorData.error || 'Wallet verification failed', code: errorData.code },
        { status },
      );
    }

    const verifyData = await shadeResponse.json();
    const accountId: string | undefined = verifyData?.account_id;
    if (!accountId) {
      logError('wallet_verify_no_account', { status: shadeResponse.status });
      return NextResponse.json({ error: 'Verification returned no account' }, { status: 502 });
    }

    // Success → mint the nova_session (subject encodes the wallet issuer).
    const result = await mintNovaSession(accountId, `wallet|${accountId}`);

    log('wallet_session_issued', { account_id: accountId });
    return NextResponse.json(result);
  } catch (error) {
    logError('wallet_verify_error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to verify wallet signature' }, { status: 500 });
  }
}