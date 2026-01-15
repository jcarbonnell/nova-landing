// src/app/api/nova/finalize-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

const MCP_BASE = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app';
const MCP_API_BASE = MCP_BASE.replace(/\/mcp$/, '');

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

  const { upload_id, encrypted_data, file_hash } = body;

  if (!upload_id || !encrypted_data || !file_hash) {
    return NextResponse.json(
      { error: 'Required: upload_id, encrypted_data, file_hash' },
      { status: 400 }
    );
  }

  console.log('Finalizing upload:', {
    upload_id,
    accountId,
    file_hash: file_hash.substring(0, 16) + '...',
    dataLength: encrypted_data.length,
  });

  try {
    const response = await fetch(`${MCP_API_BASE}/api/finalize-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-account-id': accountId,
        ...(walletId && { 'x-wallet-id': walletId }),
        ...(userEmail && { 'x-user-email': userEmail }),
      },
      body: JSON.stringify({
        upload_id,
        encrypted_data,
        file_hash,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('MCP finalize-upload error:', data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log('Upload finalized:', data);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Finalize upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Finalize failed' },
      { status: 500 }
    );
  }
}