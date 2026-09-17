// nova-landing/src/app/app/account/page.tsx
//
// The /app/account route — thin caller of requireNovaIdentity() (§8 step 3;
// the gate that was copied here in 2a is now the shared helper). Orphan until
// slice 3 adds nav; reachable by direct URL.

import { requireNovaIdentity } from '@/lib/require-identity';
import DashboardChrome from '../../DashboardChrome';
import AccountControls from '@/components/AccountControls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AccountPage() {
  const { email, accountId } = await requireNovaIdentity();
  return (
    <DashboardChrome email={email} accountId={accountId}>
      <h1 className="font-museo text-2xl md:text-3xl font-black text-nova-text mb-2 tracking-tight">
        Account
      </h1>
      <p className="font-space text-nova-text-dim mb-8">
        Manage your API key and NEAR credits.
      </p>
      <AccountControls accountId={accountId} />
    </DashboardChrome>
  );
}