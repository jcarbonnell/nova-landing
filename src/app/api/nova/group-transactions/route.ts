// nova-landing/src/app/api/nova/group-transactions/route.ts
//
// 2b read proxy — the transactions (uploads, tombstones) of one group.
//
// Takes group_id from the query string (GET read). MCP get_group_transactions
// (server.py) branches on joinability exactly like get_group_members: joinable →
// free public view; private → signed, fee'd path for an authorized member.
//
// Returns the Phase 0.5 ENRICHED array: each row carries trans_id, group_id,
// user_id, file_hash, ipfs_hash (the location), and the TxMeta join —
// backend ('FastFS' | 'Ipfs' | null), timestamp (ns string | null), and
// deleted (a DeletionRecord | null). Legacy rows have backend/timestamp/deleted
// = null. 2c renders backend badges + timestamps; Phase 4 renders the full audit
// (deletion actor + reason). The proxy forwards the shape verbatim.

import { NextRequest, NextResponse } from 'next/server';
import { resolveNovaSession, NovaProxyAuthError } from '@/lib/nova-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_URL =
  process.env.MCP_URL ||
  'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

export async function GET(req: NextRequest) {
  const groupId = new URL(req.url).searchParams.get('group_id');
  if (!groupId) {
    return NextResponse.json({ error: 'group_id required' }, { status: 400 });
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
    const response = await fetch(`${MCP_URL}/tools/get_group_transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'x-account-id': accountId,
      },
      body: JSON.stringify({ group_id: groupId }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const result = data.result ?? data ?? [];
    return NextResponse.json(Array.isArray(result) ? result : []);
  } catch {
    return NextResponse.json({ error: 'Failed to load group transactions' }, { status: 500 });
  }
}