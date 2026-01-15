// src/app/api/nova/get-key/route.ts
import { NextRequest, NextResponse } from 'next/server';

const MCP_URL = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app/mcp';

export async function POST(req: NextRequest) {
  const accountId = req.headers.get('x-account-id');
  const walletId = req.headers.get('x-wallet-id');
  const userEmail = req.headers.get('x-user-email');
  
  if (!accountId) {
    return NextResponse.json({ error: 'Missing account ID' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { group_id } = body;
  
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

  try {
    // Call MCP's get_shade_key tool via the MCP protocol
    const response = await fetch(`${MCP_URL}`, {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_shade_key',
          arguments: {
            group_id,
            payload_b64: 'auto',
            sig_hex: 'auto',
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('MCP get_shade_key error:', error);
      return NextResponse.json({ error: 'Failed to get key from MCP' }, { status: response.status });
    }

    const data = await response.json();
    
    // MCP returns result in jsonrpc format
    if (data.error) {
      console.error('MCP tool error:', data.error);
      return NextResponse.json({ error: data.error.message || 'MCP tool failed' }, { status: 500 });
    }

    // Extract key from MCP response
    // The tool returns the key directly or in a content array
    let key = data.result;
    if (data.result?.content) {
      // Handle MCP content array format
      const textContent = data.result.content.find((c: { type: string }) => c.type === 'text');
      key = textContent?.text || data.result;
    }

    return NextResponse.json({ key });
  } catch (error) {
    console.error('get-key error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}