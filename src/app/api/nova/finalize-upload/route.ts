// src/app/api/nova/finalize-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// MCP (port 8000), not Shade (port 3000). The old route defaulted to -3000 and
// called /api/finalize-upload, which MCP does not expose (it exposes
// /tools/finalize_upload) — the route was dead. Same env var as chat/route.ts.
const MCP_URL =
  process.env.MCP_URL ||
  'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

// 8.1b: hash identity fields for logs (port of Shade's hashForLog); never log
// raw account IDs to Vercel. 12 chars = cross-line correlation without exposing
// the value.
function hashForLog(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { upload_id, encrypted_data, file_hash } = body;

  // Presence guard only. file_hash format (64-hex) is validated by MCP — not
  // duplicated here (single source of truth for the format constraint).
  if (!upload_id || !encrypted_data || !file_hash) {
    return NextResponse.json(
      { error: 'Required: upload_id, encrypted_data, file_hash' },
      { status: 400 }
    );
  }

  // Mint a nova_session token server-side from the Auth0 cookie. The client's
  // x-account-id is deliberately NOT trusted or forwarded (v0.4 Fix A / §5.0):
  // Transport B: wallet users present a nova_session cookie (set by
  // wallet-verify); email users mint one from their Auth0 session. Both then
  // carry the same Bearer token to MCP, which enforces upload_id ownership
  // against the authenticated account.
  let sessionToken: string;
  let accountId: string;

  const walletSession = req.cookies.get('nova_session')?.value;
  if (walletSession) {
    sessionToken = walletSession;
    try {
      const claims = JSON.parse(
        Buffer.from(walletSession.split('.')[1], 'base64').toString('utf8'),
      );
      accountId = claims.account_id;
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    if (!accountId) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
  } else {
    const origin = new URL(req.url).origin;
    try {
      const tokenRes = await fetch(`${origin}/api/auth/session-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.get('cookie') ?? '',
        },
        body: '{}',
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        return NextResponse.json(
          { error: err.error || 'Unauthorized' },
          { status: tokenRes.status }
        );
      }

      const tokenData = await tokenRes.json();
      sessionToken = tokenData.token;
      accountId = tokenData.account_id;
    } catch {
      return NextResponse.json({ error: 'Failed to authenticate' }, { status: 500 });
    }
  }

  console.log('finalize_upload', {
    account_hash: hashForLog(accountId),
    upload_id,
    file_hash_prefix: file_hash.slice(0, 16),
    data_length: encrypted_data.length,
  });

  try {
    const response = await fetch(`${MCP_URL}/tools/finalize_upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'x-account-id': accountId, // resolved, not client-supplied
      },
      body: JSON.stringify({ upload_id, encrypted_data, file_hash }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('finalize_upload MCP error', {
        status: response.status,
        code: data.code,
      });
      return NextResponse.json(data, { status: response.status });
    }

    // Unwrap MCP's REST envelope ({ result: {...} }) so the frontend reads
    // cid/trans_id at top level, matching callMCPTool's `result.result || result`.
    const result = data.result ?? data;
    return NextResponse.json(result);
  } catch (error) {
    console.error('finalize_upload proxy error', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Finalize failed' }, { status: 500 });
  }
}