// src/app/api/nova/retrieve/route.ts
import { NextRequest, NextResponse } from 'next/server';

const MCP_URL = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app/mcp';

export async function POST(req: NextRequest) {
  const accountId = req.headers.get('x-account-id');
  const walletId = req.headers.get('x-wallet-id');
  const userEmail = req.headers.get('x-user-email');

  if (!accountId) {
    return NextResponse.json({ error: 'Missing account ID' }, { status: 400 });
  }

  const { group_id, ipfs_hash } = await req.json();

  if (!group_id || !ipfs_hash) {
    return NextResponse.json(
      { error: 'Required: group_id, ipfs_hash' },
      { status: 400 }
    );
  }

  // Build headers for MCP
  const mcpHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-account-id': accountId,
  };

  if (walletId) {
    mcpHeaders['Authorization'] = `Bearer wallet:${walletId}`;
    mcpHeaders['x-wallet-id'] = walletId;
  }
  if (userEmail) {
    mcpHeaders['x-user-email'] = userEmail;
  }

  // Call MCP composite_retrieve
  const response = await fetch(`${MCP_URL}`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      method: 'tools/call',
      params: {
        name: 'composite_retrieve',
        arguments: {
          group_id,
          ipfs_hash,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json({ error }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data.result || data);
}