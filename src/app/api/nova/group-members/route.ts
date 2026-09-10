// nova-landing/src/app/api/nova/group-members/route.ts
//
// 2b read proxy — the members of one group.
//
// Takes group_id from the query string (GET read). MCP get_group_members
// (server.py) branches on joinability: joinable groups use the free public
// view; private groups use the signed, fee'd path and return the list only to an
// authorized member. Either way the proxy just forwards the resolved session —
// MCP enforces the authorization. An unauthorized caller on a private group is
// rejected by MCP and surfaced here with MCP's status.
//
// Returns a JSON array of member account-id strings.

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
    const response = await fetch(`${MCP_URL}/tools/get_group_members`, {
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
    return NextResponse.json({ error: 'Failed to load group members' }, { status: 500 });
  }
}