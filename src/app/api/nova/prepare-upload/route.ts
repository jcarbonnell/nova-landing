// nova-landing/src/app/api/nova/prepare-upload/route.ts
//
// W0 — the upload broker for the chat's client-side prepare_upload tool. Same §5.0
// shape as prepare-retrieve (resolveNovaSession → MCP → unwrap). Returns to the
// BROWSER the per-file key and upload_id (and, for wallet sessions, the FastFS
// location the wallet records first). The browser encrypts locally; the model never
// sees this response (src/lib/chat-tools.ts, test/check-chat-no-secrets.ts).
//
// MCP prepare_upload takes { group_id, filename } and returns
//   { upload_id, key, group_id, filename, location? }.

import { NextRequest, NextResponse } from 'next/server';
import { resolveNovaSession, NovaProxyAuthError } from '@/lib/nova-proxy';
import { mcpUrl } from '@/lib/server-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { group_id?: unknown; filename?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { group_id, filename } = body;
  if (typeof group_id !== 'string' || !group_id || typeof filename !== 'string' || !filename) {
    return NextResponse.json({ error: 'group_id and filename required' }, { status: 400 });
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
    const response = await fetch(`${mcpUrl()}/tools/prepare_upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'x-account-id': accountId, // resolved, not client-supplied
      },
      body: JSON.stringify({ group_id, filename }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }
    return NextResponse.json(data.result ?? data);
  } catch {
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
  }
}