// src/app/api/auth/wallet-nonce/route.ts
//
// Step 1 of wallet SIWN (§5.11-A): issue a server-side NEP-413 nonce.
//
// Thin server-side proxy. The browser CANNOT call Shade directly (Shade is
// internal-only, gated by X-Internal-Auth which must never reach client JS —
// the Fix I/E class of leak). So the browser hits THIS route, which forwards to
// Shade with the internal secret. Same pattern as session-token → Shade.
//
// Mints no token, reads no Auth0 session — it only relays a nonce. The nonce is
// opaque to the client; it passes it straight into wallet.signMessage({ nonce }).

import { NextResponse } from 'next/server';
import { log, logError } from '@/lib/log';

export async function POST() {
  try {
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (!shadeUrl || !internalSecret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const shadeResponse = await fetch(`${shadeUrl}/rpc/wallet/nonce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalSecret,
      },
      body: JSON.stringify({}), // no input; the route mints a fresh nonce
      signal: AbortSignal.timeout(10000),
    });

    if (!shadeResponse.ok) {
      const errorText = await shadeResponse.text();
      logError('wallet_nonce_shade_failed', {
        status: shadeResponse.status,
        error: errorText.slice(0, 200),
      });
      return NextResponse.json({ error: 'Could not issue nonce' }, { status: 502 });
    }

    const data = await shadeResponse.json();
    if (!data?.nonce) {
      logError('wallet_nonce_missing', { status: shadeResponse.status });
      return NextResponse.json({ error: 'Could not issue nonce' }, { status: 502 });
    }

    log('wallet_nonce_issued', {});
    return NextResponse.json({ nonce: data.nonce });
  } catch (error) {
    logError('wallet_nonce_error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to issue nonce' }, { status: 500 });
  }
}