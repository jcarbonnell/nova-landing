// nova-landing/src/app/api/nova/owned-groups/route.ts
//
// 2b read proxy — the groups the signed-in account OWNS.
//
// Thin adapter over the §5.0 shared boundary: resolveNovaSession (wallet cookie
// first, else mint from Auth0) → MCP /tools/get_owned_groups with the Bearer →
// unwrap the { result } envelope. The browser never holds the token; identity is
// server-resolved and the client's x-account-id is never trusted (v0.4 Fix A).
//
// MCP shape (server.py): get_owned_groups takes NO args (identity from the
// verified session) and returns a JSON array of group-id strings, wrapped as
// { result: [...] } by expose_as_rest. Owner is auto-added as a member, so an
// owned group ALSO appears in member-groups — the owner/member merge is 2c's job.
//
// GET: a read with no request body. The browser→proxy hop is GET; the proxy→MCP
// hop is POST (MCP /tools/* are POST-only).

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
    const response = await fetch(`${MCP_URL}/tools/get_owned_groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'x-account-id': accountId, // resolved, not client-supplied
      },
      body: '{}',
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    // Unwrap MCP's { result: [...] } envelope; default to [] so the client
    // always gets an array.
    const result = data.result ?? data ?? [];
    return NextResponse.json(Array.isArray(result) ? result : []);
  } catch {
    return NextResponse.json({ error: 'Failed to load owned groups' }, { status: 500 });
  }
}