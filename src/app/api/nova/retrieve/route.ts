// src/app/api/nova/retrieve/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud';

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

  const { group_id, ipfs_hash } = body;

  if (!group_id || !ipfs_hash) {
    return NextResponse.json(
      { error: 'Required: group_id, ipfs_hash' },
      { status: 400 }
    );
  }

  // Validate CID format
  if (!ipfs_hash.startsWith('Qm') && !ipfs_hash.startsWith('bafy')) {
    return NextResponse.json(
      { error: 'Invalid IPFS hash format' },
      { status: 400 }
    );
  }

  console.log('retrieve request:', { accountId, group_id, ipfs_hash });

  try {
    // Fetch encrypted data from IPFS via Pinata gateway
    const gatewayUrl = `${PINATA_GATEWAY}/ipfs/${ipfs_hash}`;
    
    const response = await fetch(gatewayUrl, {
      method: 'GET',
      headers: {
        'Accept': '*/*',
      },
    });

    if (!response.ok) {
      console.error('IPFS fetch failed:', response.status);
      if (response.status === 404) {
        return NextResponse.json({ error: 'File not found on IPFS' }, { status: 404 });
      }
      throw new Error('Failed to retrieve file from IPFS');
    }

    // Get the encrypted data as text (it's base64-encoded)
    const encrypted_b64 = await response.text();

    console.log('Retrieved encrypted data:', {
      ipfs_hash,
      dataLength: encrypted_b64.length,
    });

    return NextResponse.json({
      encrypted_b64,
      ipfs_hash,
      group_id,
    });
  } catch (error) {
    console.error('retrieve error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Retrieve failed' },
      { status: 500 }
    );
  }
}