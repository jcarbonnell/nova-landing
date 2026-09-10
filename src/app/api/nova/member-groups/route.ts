// nova-landing/src/app/api/nova/member-groups/route.ts
//
// 2b read proxy — the groups the signed-in account is a MEMBER of.
//
// Identical adapter shape to owned-groups (resolveNovaSession → MCP → unwrap).
// MCP get_member_groups takes NO args (identity from the session) and returns a
// JSON array of group-id strings. Because an owner is auto-added as a member, an
// account's OWNED groups also appear here; 2c merges the two lists and tags a
// group `owner` (if in owned) and/or `member` (if in member-of).

import { NextRequest, NextResponse } from 'next/server';
import { resolveNovaSession, NovaProxyAuthError } from '@/lib/nova-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MCP_URL =
  process.env.MCP_URL ||
  'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';

export async function GET(req: NextRequest) {
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
    const response = await fetch(`${MCP_URL}/tools/get_member_groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'x-account-id': accountId,
      },
      body: '{}',
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    const result = data.result ?? data ?? [];
    return NextResponse.json(Array.isArray(result) ? result : []);
  } catch {
    return NextResponse.json({ error: 'Failed to load member groups' }, { status: 500 });
  }
}