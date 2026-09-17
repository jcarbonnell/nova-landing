// nova-landing/src/app/app/page.tsx
//
// /app bare — gated redirect. Runs requireNovaIdentity() first so an unauthed
// hit still redirects to '/' (never leaks past the gate), then sends an authed
// user to the section landing. TEMPORARY target /app/files (slice 2); slice 4
// retargets to /app/account per D1.

import { redirect } from 'next/navigation';
import { requireNovaIdentity } from '@/lib/require-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AppPage() {
  await requireNovaIdentity(); // unauth → redirect('/') inside the helper
  redirect('/app/files');
}