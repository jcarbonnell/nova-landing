// nova-landing/src/app/api/nova/prepare-retrieve/route.ts
//
// 3a — the retrieval broker for Phase 3 (browser-side decrypt + integrity badge).
//
// Same §5.0 shape as the Phase 2 read proxies (resolveNovaSession → MCP → unwrap),
// but this one returns the material the BROWSER needs to decrypt: the (wrapped)
// per-file/group key, the ciphertext (base64), and the format descriptor. The
// server only BROKERS these — it never decrypts, never sees plaintext. The
// browser runs decodeFile(encrypted_b64, key, format) and computes the integrity
// hash locally. This split is the dashboard's defining privacy property (§6.4).
//
// MCP prepare_retrieve (server.py) takes { group_id, ipfs_hash } where ipfs_hash
// carries whatever the on-chain record stored in its location field — a legacy
// IPFS CID (→ group key + IPFS fetch, format=null/v0) OR a FastFS location
// (→ per-file key + FastFS fetch + format/v1). It branches internally; the proxy
// forwards verbatim. Returns:
//   { key, encrypted_b64, ipfs_hash, location, group_id, format }
//
// NOTE on the wallet + private-group gap (same as Phase 2): a FastFS retrieve on
// a private group routes through MCP's signed path (_get_shade_key_internal /
// fastfs retrieve) which needs the group key; for a wallet user with no custodial
// key that 501s (wrapped 500 "Failed to get signer"). The dashboard surfaces the
// same retry-less "coming with client-side signing" notice via dashboard-client's
// walletSignerUnavailable detection — no special handling needed here.

import { NextRequest, NextResponse } from 'next/server';
import { resolveNovaSession, NovaProxyAuthError } from '@/lib/nova-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_URL =
  process.env.MCP_URL ||
  'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const groupId = params.get('group_id');
  const ipfsHash = params.get('ipfs_hash'); // the location/CID from the tx row

  if (!groupId || !ipfsHash) {
    return NextResponse.json(
      { error: 'group_id and ipfs_hash required' },
      { status: 400 },
    );
  }

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

  try {
    const response = await fetch(`${MCP_URL}/tools/prepare_retrieve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'x-account-id': accountId, // resolved, not client-supplied
      },
      body: JSON.stringify({ group_id: groupId, ipfs_hash: ipfsHash }),
    });

    const data = await response.json();
    if (!response.ok) {
      // Forward MCP's status + body (carries the wallet-signer 500 the client
      // detects for its "coming with client-side signing" notice).
      return NextResponse.json(data, { status: response.status });
    }

    // Unwrap MCP's { result: {...} } envelope.
    const result = data.result ?? data;
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to prepare retrieve' }, { status: 500 });
  }
}