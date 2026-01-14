// src/app/api/nova/get-key/route.ts
import { NextRequest, NextResponse } from 'next/server';

const MCP_URL = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app';

export async function POST(req: NextRequest) {
  const accountId = req.headers.get('x-account-id');
  const walletId = req.headers.get('x-wallet-id');
  const userEmail = req.headers.get('x-user-email');
  
  if (!accountId) {
    return NextResponse.json({ error: 'Missing account ID' }, { status: 400 });
  }

  const { group_id } = await req.json();
  
  if (!group_id) {
    return NextResponse.json({ error: 'group_id required' }, { status: 400 });
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

  // Call MCP's get_shade_key endpoint
  const response = await fetch(`${MCP_URL}/api/nova/get-key`, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      group_id,
      payload_b64: 'auto',
      sig_hex: 'auto',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json({ error }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json({ key: data.key || data });
}