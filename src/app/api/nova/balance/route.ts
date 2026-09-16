// nova-landing/src/app/api/nova/balance/route.ts
//
// 2d — the signed-in account's NEAR balance (a public on-chain fact).
//
// A DIRECT RPC view, not an MCP hop: view_account is public, needs no key, no
// Shade, no session token AT the RPC layer. But identity still comes from the
// verified session (resolveNovaSession — §5.0 / Fix A): we read the balance of
// the SESSION's account, never a client-supplied one, so the route can't be an
// open oracle for arbitrary accounts.
//
// RPC: NEXT_PUBLIC_RPC_URL — the keyless PUBLIC endpoint (rpc.mainnet/testnet.
// near.org), server-side here. The FastNear keyed URLs live only in Shade/MCP;
// a key must never enter nova-landing (it'd inline into the client bundle). A
// balance view doesn't need one.
//
// GET, no body. Returns { account_id, balance_yocto, balance_near } where
// balance_near is a 4-decimal string ("12.3456"). On RPC failure → 502 so the
// client shows its error+retry (distinct from an auth failure).

import { NextRequest, NextResponse } from 'next/server';
import { JsonRpcProvider } from '@near-js/providers';
import type { AccountView } from '@near-js/types';
import { resolveNovaSession, NovaProxyAuthError } from '@/lib/nova-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.mainnet.near.org';

// yoctoNEAR (10^24) → NEAR, 4 decimals, no rounding surprises for display.
function formatNear(yocto: bigint): string {
  // Exact BigInt math — Number()/1e24 would lose precision on 24-digit values.
  const y = yocto;
  const base = BigInt('1000000000000000000000000'); // 10^24 (yoctoNEAR per NEAR)
  const whole = y / base;
  const frac = y % base;
  const frac4 = (frac * BigInt(10000) / base).toString().padStart(4, '0');
  return `${whole.toString()}.${frac4}`;
}

export async function GET(req: NextRequest) {
  let accountId: string;
  try {
    ({ accountId } = await resolveNovaSession(req));
  } catch (e) {
    if (e instanceof NovaProxyAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'Failed to authenticate' }, { status: 500 });
  }

  try {
    const provider = new JsonRpcProvider({ url: RPC_URL });
    const account = await provider.query<AccountView>({
      request_type: 'view_account',
      finality: 'final',
      account_id: accountId,
    });

    return NextResponse.json({
      account_id: accountId,
      balance_yocto: account.amount.toString(),
      balance_near: formatNear(account.amount),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to read balance' }, { status: 502 });
  }
}