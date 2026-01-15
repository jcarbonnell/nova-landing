// src/app/api/nova/retrieve/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Your custom Pinata gateway (without /ipfs suffix - we'll add it)
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

export async function POST(req: NextRequest) {
  const accountId = req.headers.get('x-account-id');

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
    // Build gateway URL
    // Handle both formats: "https://gateway.com/ipfs" and "https://gateway.com/ipfs/"
    const gateway = PINATA_GATEWAY.endsWith('/') 
      ? PINATA_GATEWAY.slice(0, -1) 
      : PINATA_GATEWAY;
    
    // If gateway already ends with /ipfs, don't add it again
    const gatewayUrl = gateway.endsWith('/ipfs')
      ? `${gateway}/${ipfs_hash}`
      : `${gateway}/ipfs/${ipfs_hash}`;

    console.log('Fetching from:', gatewayUrl);

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
      throw new Error(`Failed to retrieve file from IPFS: ${response.status}`);
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