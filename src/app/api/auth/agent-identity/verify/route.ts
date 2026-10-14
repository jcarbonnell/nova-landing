// nova-landing/src/app/api/auth/agent-identity/verify/route.ts
//
// Step 2 of Agent Connect identity sign-in (phase-2 identity bridge).
// Sibling of wallet-verify/route.ts, for AGENT BACKENDS rather than browsers.
//
// Body: { challenge, signature: { near_account_id, public_key, signature, nonce,
//         recipient } } — `signature` is the Agent API's sign response, as-is.
// Forwards ONLY those fields to Shade, which verifies the NEP-413 signature over
// the message IT stored for `challenge`, checks the key controls the account
// (on-chain full-access key, or an implicit account not yet on chain whose id
// is the key), and consumes the challenge. On success we mint a nova_session.
//
// DIFFERENCES FROM wallet-verify (deliberate):
//   - The token is returned in the JSON body and NO cookie is set: the caller is
//     a backend (like session-token Path 0), not a browser.
//   - No `message` is accepted or forwarded: Shade verifies its own stored copy.
//   - 503 from Shade (account lookup unavailable) is passed through as 503 so
//     the caller retries; nothing was consumed.
//
// Subject `wallet|<account>`: same security property as browser SIWN (a key the
// holder controls, proven by NEP-413), so MCP's wallet-tier handling applies
// unchanged. Provenance is in the logs (auth_method: intents_identity).
// NOVA never holds the agent's key.

import { NextRequest, NextResponse } from 'next/server';
import { mintNovaSession } from '@/lib/session';
import { log, logError } from '@/lib/log';

const SIG_FIELDS = ['near_account_id', 'public_key', 'signature', 'nonce', 'recipient'] as const;

export async function POST(req: NextRequest) {
  try {
    const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL;
    const internalSecret = process.env.INTERNAL_API_SECRET;
    const sessionSecret = process.env.SESSION_TOKEN_SECRET;
    if (!shadeUrl || !internalSecret || !sessionSecret) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    let body: { challenge?: unknown; signature?: Record<string, unknown> } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const sig = body.signature;
    if (
      typeof body.challenge !== 'string' ||
      !sig || typeof sig !== 'object' ||
      !SIG_FIELDS.every((f) => typeof sig[f] === 'string' && (sig[f] as string).length > 0)
    ) {
      return NextResponse.json(
        { error: 'Missing challenge or signature fields (near_account_id, public_key, signature, nonce, recipient)' },
        { status: 400 },
      );
    }

    // Rebuild the payload from the known fields only — nothing else reaches Shade.
    const forward = {
      challenge: body.challenge,
      signature: Object.fromEntries(SIG_FIELDS.map((f) => [f, sig[f] as string])),
    };

    const shadeResponse = await fetch(`${shadeUrl}/rpc/agent-identity/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalSecret,
      },
      body: JSON.stringify(forward),
      signal: AbortSignal.timeout(15000), // two RPC views behind it
    });

    if (!shadeResponse.ok) {
      // Shade returns { error, code } with code ∈ {UNAUTHORIZED,
      // UNAUTHORIZED_NONCE_REPLAY, KEY_LOOKUP_UNAVAILABLE, VALIDATION_FAILED, …}.
      const errorData = await shadeResponse.json().catch(() => ({}));
      const s = shadeResponse.status;
      const status = s === 401 || s === 400 || s === 503 ? s : 502;
      logError('agent_identity_rejected', {
        status: s,
        code: typeof errorData.code === 'string' ? errorData.code : undefined,
      });
      return NextResponse.json(
        { error: errorData.error || 'Agent identity verification failed', code: errorData.code },
        { status },
      );
    }

    const verifyData = await shadeResponse.json();
    const accountId: string | undefined = verifyData?.account_id;
    if (!accountId || typeof accountId !== 'string') {
      logError('agent_identity_no_account', { status: shadeResponse.status });
      return NextResponse.json({ error: 'Verification returned no account' }, { status: 502 });
    }

    const result = await mintNovaSession(accountId, `wallet|${accountId}`);
    log('agent_identity_session_issued', { account_id: accountId, auth_method: 'intents_identity' });

    return NextResponse.json(result); // { token, account_id, expires_in } — no cookie
  } catch (error) {
    logError('agent_identity_verify_error', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to verify agent identity' }, { status: 500 });
  }
}