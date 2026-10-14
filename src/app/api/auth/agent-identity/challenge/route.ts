// nova-landing/src/app/api/auth/agent-identity/challenge/route.ts
//
// Step 1 of Agent Connect identity sign-in (phase-2 identity bridge).
// Sibling of wallet-nonce/route.ts, for AGENT BACKENDS rather than browsers.
//
// Thin server-side proxy: Shade is internal-only (X-Internal-Auth never leaves
// the server), so callers hit this route, which forwards to Shade. Shade builds
// the Agent API's canonical 7-field identity challenge, stores it, and returns:
//   { message, challenge, audience, expires_at_ms }
// The caller passes `message` VERBATIM to the Agent API's sign endpoint
// (api.sign), then posts the API's signature + `challenge` to ../verify.
// `audience` is the NEAR account the agent owner must allow in the policy's
// `sign.recipients`. Mints no token.

import { NextResponse } from 'next/server';
import { log, logError } from '@/lib/log';

export async function POST() {
  try {
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (!shadeUrl || !internalSecret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const shadeResponse = await fetch(`${shadeUrl}/rpc/agent-identity/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalSecret,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });

    if (!shadeResponse.ok) {
      const errorData = await shadeResponse.json().catch(() => ({}));
      logError('agent_challenge_shade_failed', {
        status: shadeResponse.status,
        code: typeof errorData.code === 'string' ? errorData.code : undefined,
      });
      // 503 (challenge store at capacity) is retryable — pass it through as such.
      if (shadeResponse.status === 503) {
        return NextResponse.json(
          { error: 'Too many outstanding challenges, retry shortly', code: errorData.code },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: 'Could not issue challenge' }, { status: 502 });
    }

    const data = await shadeResponse.json();
    if (
      typeof data?.message !== 'string' ||
      typeof data?.challenge !== 'string' ||
      typeof data?.audience !== 'string' ||
      typeof data?.expires_at_ms !== 'number'
    ) {
      logError('agent_challenge_malformed', { status: shadeResponse.status });
      return NextResponse.json({ error: 'Could not issue challenge' }, { status: 502 });
    }

    log('agent_challenge_issued', {});
    return NextResponse.json({
      message: data.message,
      challenge: data.challenge,
      audience: data.audience,
      expires_at_ms: data.expires_at_ms,
    });
  } catch (error) {
    logError('agent_challenge_error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to issue challenge' }, { status: 500 });
  }
}