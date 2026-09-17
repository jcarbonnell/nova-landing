// nova-landing/src/app/app/files/page.tsx
//
// §8 step 3 slice 2 — the Files section, moved from /app bare to its own route.
// Same gate (requireNovaIdentity) + same DashboardShell render that /app had;
// only the URL changed. /app bare now redirects here (slice 2) until slice 4
// retargets /app → /app/account per D1.

import { requireNovaIdentity } from '@/lib/require-identity';
import DashboardShell from '../../DashboardShell';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FilesPage() {
  const { email, accountId } = await requireNovaIdentity();
  return <DashboardShell email={email} accountId={accountId} />;
}