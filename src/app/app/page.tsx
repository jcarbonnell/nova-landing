// nova-landing/src/app/app/page.tsx
//
// The /app gate — now a thin caller of the shared requireNovaIdentity() helper
// (§8 step 3). Behaviour unchanged: unauth → redirect('/'), else render the
// dashboard shell with server-resolved { email, accountId }.

import { requireNovaIdentity } from '@/lib/require-identity';
import DashboardShell from '../DashboardShell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AppPage() {
  const { email, accountId } = await requireNovaIdentity();
  return <DashboardShell email={email} accountId={accountId} />;
}