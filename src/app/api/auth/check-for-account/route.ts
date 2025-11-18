// src/app/api/auth/check-for-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth0';

// Validate env vars
if (!process.env.NEXT_PUBLIC_RPC_URL) {
  throw new Error('NEXT_PUBLIC_RPC_URL env var missing—add to .env.local (e.g., https://rpc.testnet.near.org)');
}

if (!process.env.NEXT_PUBLIC_PARENT_DOMAIN) {
  throw new Error('NEXT_PUBLIC_PARENT_DOMAIN env var missing (e.g., nova-sdk-5.testnet)');
}

// Full response shape from near-api-js (for view_account)
interface ViewAccountResponse {
  kind: 'ViewAccount';
  result: {
    code_hash: string | null;
    storage_paid: { total: string; owned: number; storage_byte_cost: string; } | null;
  };
}

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await getServerSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    const fullId = username.includes('.') ? username : `${username}.${parentDomain}`;

    // Dynamic regex using the env var
    const domainEscaped = parentDomain.replace('.', '\\.');
    const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
    if (!regex.test(fullId)) {
      return NextResponse.json(
        { error: `Invalid account ID format (must end with .${parentDomain})` },
        { status: 400 }
      );
    }

    // Async import near-api-js (tree-shake for server)
    const near = await import('near-api-js');
    const { JsonRpcProvider } = near.providers;

    // Fallback if env fails (dev safety)
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL!;
    if (!rpcUrl) throw new Error('NEXT_PUBLIC_RPC_URL is required');
    const provider = new JsonRpcProvider({ url: rpcUrl }); // Object for ConnectionInfo

    // Query account existence (balance >0 or status)
    const rawResponse = await provider.query({
      request_type: 'view_account',
      finality: 'final',
      account_id: fullId,
    });

    // Bridge union: Cast to unknown first, then assert shape (TS safe for known request_type)
    const response = rawResponse as unknown as ViewAccountResponse;
    const exists = response.result.code_hash !== null && response.result.storage_paid !== null;

    return NextResponse.json({ exists, accountId: exists ? fullId : null });
  } catch (error) {
    console.error('Check account error:', error);
    return NextResponse.json({ error: 'Server error during check' }, { status: 500 });
  }
}