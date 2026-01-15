// src/app/api/nova/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PINATA_API_KEY = process.env.IPFS_API_KEY;
const PINATA_API_SECRET = process.env.IPFS_API_SECRET;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
const MCP_BASE = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app';
const MCP_ENDPOINT = MCP_BASE.endsWith('/mcp') ? MCP_BASE : `${MCP_BASE}/mcp`;

if (!PINATA_API_KEY || !PINATA_API_SECRET) {
  console.error('IPFS_API_KEY or IPFS_API_SECRET is not configured');
}

export async function POST(req: NextRequest) {
  const accountId = req.headers.get('x-account-id');
  const walletId = req.headers.get('x-wallet-id');
  const userEmail = req.headers.get('x-user-email');

  if (!accountId) {
    return NextResponse.json({ error: 'Missing account ID' }, { status: 400 });
  }

  if (!PINATA_API_KEY || !PINATA_API_SECRET) {
    return NextResponse.json({ error: 'IPFS credentials not configured' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { group_id, encrypted_data, filename, file_hash } = body;

  if (!group_id || !encrypted_data || !filename || !file_hash) {
    return NextResponse.json(
      { error: 'Required: group_id, encrypted_data, filename, file_hash' },
      { status: 400 }
    );
  }

  // Validate file_hash format (SHA-256 hex)
  if (!/^[a-f0-9]{64}$/i.test(file_hash)) {
    return NextResponse.json(
      { error: 'file_hash must be 64-char hex (SHA-256)' },
      { status: 400 }
    );
  }

  console.log('upload request:', {
    accountId,
    group_id,
    filename,
    file_hash: file_hash.substring(0, 16) + '...',
    dataLength: encrypted_data.length,
  });

  try {
    // Step 1: Upload encrypted data to IPFS via Pinata
    const cid = await uploadToIPFS(encrypted_data, filename);
    console.log('IPFS upload success:', cid);

    // Step 2: Record transaction on NEAR via MCP
    const transId = await recordTransaction({
      accountId,
      walletId,
      userEmail,
      group_id,
      file_hash,
      ipfs_hash: cid,
    });
    console.log('Transaction recorded:', transId);

    return NextResponse.json({
      cid,
      trans_id: transId,
      file_hash,
    });
  } catch (error) {
    console.error('upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

async function uploadToIPFS(encryptedData: string, filename: string): Promise<string> {
  // Create form data with the encrypted content
  const blob = new Blob([encryptedData], { type: 'application/octet-stream' });
  const formData = new FormData();
  formData.append('file', blob, filename);

  // Optional: Add metadata
  const metadata = JSON.stringify({
    name: filename,
    keyvalues: {
      encrypted: 'true',
      source: 'nova-sdk',
    },
  });
  formData.append('pinataMetadata', metadata);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'pinata_api_key': PINATA_API_KEY!,
      'pinata_secret_api_key': PINATA_API_SECRET!,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Pinata upload failed:', response.status, errorText.substring(0, 200));
    throw new Error(`IPFS upload failed: ${response.status}`);
  }

  const data = await response.json();
  return data.IpfsHash;
}

async function recordTransaction(params: {
  accountId: string;
  walletId?: string | null;
  userEmail?: string | null;
  group_id: string;
  file_hash: string;
  ipfs_hash: string;
}): Promise<string> {
  const { accountId, walletId, userEmail, group_id, file_hash, ipfs_hash } = params;

  // Build headers for MCP
  const mcpHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'x-account-id': accountId,
  };

  if (walletId) {
    mcpHeaders['Authorization'] = `Bearer wallet:${walletId}`;
    mcpHeaders['x-wallet-id'] = walletId;
  }
  if (userEmail) {
    mcpHeaders['x-user-email'] = userEmail;
  }

  // Call MCP to record the transaction on NEAR
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: mcpHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'record_near_transaction',
        arguments: {
          group_id,
          user_id: accountId,
          file_hash,
          ipfs_hash,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('MCP record_transaction failed:', response.status, errorText.substring(0, 200));
    throw new Error('Failed to record transaction on blockchain');
  }

  const data = await response.json();

  if (data.error) {
    console.error('MCP tool error:', data.error);
    throw new Error(data.error.message || 'Transaction recording failed');
  }

  // Extract transaction ID from response
  let result = data.result;
  if (data.result?.content) {
    const textContent = data.result.content.find((c: { type: string }) => c.type === 'text');
    if (textContent?.text) {
      try {
        result = JSON.parse(textContent.text);
      } catch {
        result = { trans_id: textContent.text };
      }
    }
  }

  return result?.trans_id || result?.transaction_id || result || 'unknown';
}