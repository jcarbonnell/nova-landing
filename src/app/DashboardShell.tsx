// src/app/DashboardShell.tsx
//
// Phase 1 (file-viewer dashboard, roadmap §6.4) — the /app client shell.
// Now a thin composition: DashboardChrome (§8 step 2a-0) wrapping the Files
// heading + DashboardBody. Identity is resolved server-side in app/page.tsx and
// handed down as plain string props; the chrome carries no NOVA-specific types.

'use client';

import DashboardChrome from './DashboardChrome';
import DashboardBody from './DashboardBody';

interface DashboardShellProps {
  email: string;
  accountId: string;
}

export default function DashboardShell({ email, accountId }: DashboardShellProps) {
  return (
    <DashboardChrome email={email} accountId={accountId}>
      <h1 className="font-museo text-2xl md:text-3xl font-black text-nova-text mb-2 tracking-tight">
        Your groups
      </h1>
      <p className="font-space text-nova-text-dim mb-8">
        Signed in as <span className="text-nova-text">{accountId}</span>.
      </p>

      <DashboardBody accountId={accountId} />
    </DashboardChrome>
  );
}