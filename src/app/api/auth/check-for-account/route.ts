// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth0';

// Validate env vars
if (!process.env.NEXT_PUBLIC_RPC_URL) {
  throw new Error('NEXT_PUBLIC_RPC_URL env var missing—add to .env.local (e.g., https://rpc.testnet.near.org)');
}

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await getServerSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fullId = username.includes('.') ? username : `${username}.nova-sdk.near`;
    if (!/^[a-z0-9_-]{2,64}\.(nova-sdk\.near|testnet|mainnet)$/.test(fullId)) { // Basic validation
      return NextResponse.json({ error: 'Invalid account ID format (e.g., user.nova-sdk.near)' }, { status: 400 });
    }

    // Async import near-api-js (tree-shake for server)
    const near = await import('near-api-js');
    const { JsonRpcProvider } = near.providers;

    // Fallback if env fails (dev safety)
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.testnet.near.org';
    const provider = new JsonRpcProvider({ url: rpcUrl }); // Object for ConnectionInfo

    // Query account existence (balance >0 or status)
    const accountView = await provider.query({
      request_type: 'view_account',
      finality: 'final',
      account_id: fullId,
    }) as any; // near-api-js types are loose; cast for simplicity

    // Exists if not empty/error (basic check; enhance with contract view if needed)
    const exists = accountView.code_hash !== null && accountView.storage_paid !== null; // Non-empty account

    return NextResponse.json({ exists });
  } catch (error) {
    console.error('Check account error:', error);
    return NextResponse.json({ error: 'Server error during check' }, { status: 500 });
  }
}