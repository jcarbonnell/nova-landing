// src/app/api/nova/finalize-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { resolveNovaSession, NovaProxyAuthError } from '@/lib/nova-proxy';

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
  // Legacy custodial-wallet guard (v0.3.2 Fix 5): reject a bare x-wallet-id
  // assertion at the boundary. Preserved verbatim from the deployed route.
  // NOTE (flagged, not changed in 2a): under SIWN, wallet users authenticate via
  // the nova_session cookie (resolveNovaSession reads it first) and send NO
  // x-wallet-id header, so this guard is now vestigial defense-in-depth. Whether
  // to retire it is a deliberate decision to make on its own, not silently inside
  // the proxy-helper extraction — so it stays exactly as deployed for now.
  if (req.headers.get('x-wallet-id')) {
    return NextResponse.json(
      {
        error: 'Wallet auth disabled pending self-custody migration (v0.5)',
        code: 'WALLET_AUTH_PENDING_SELF_CUSTODY',
      },
      { status: 501 }
    );
  }

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

  // Resolve identity via the shared proxy helper (§5.0 single point): wallet
  // nova_session cookie first, else mint from the Auth0 session. The client's
  // x-account-id is never trusted (v0.4 Fix A); MCP re-verifies the Bearer and
  // enforces upload_id ownership against the authenticated account.
  let sessionToken: string;
  let accountId: string;
  try {
    ({ sessionToken, accountId } = await resolveNovaSession(req));
  } catch (e) {
    if (e instanceof NovaProxyAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Failed to authenticate' }, { status: 500 });
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