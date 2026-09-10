// nova-landing/src/app/DashboardShell.tsx
//
// Phase 1 (file-viewer dashboard, roadmap §6.4) — the /app client shell.
//
// Page-level client root for /app, exactly as HomeClient is for / — same layer,
// same folder. Deliberately SELF-CONTAINED: it imports no WalletProvider, no
// HomeClient, no wallet hooks, so none of HomeClient's custodial/racing-callback
// surface can leak in (the §5.13/§D1 "do not deepen HomeClient" constraint).
//
// Identity is resolved SERVER-SIDE in app/page.tsx and handed down as plain
// string props { email, accountId } — no token ever crosses to the browser, and
// the props carry no NOVA-specific types, so the topbar/identity primitive stays
// reusable (Fleet Dashboard, Phase 5) without extraction now.
//
// Phase 1 scope: signed-in shell, identity in the topbar, working sign-out,
// session survives refresh (guaranteed by the server gate re-running on each
// load). The body is a placeholder marking where Phase 2's owned+member group
// list (list→detail) mounts. No data fetching happens yet — so no /api/nova
// call and no 401 re-auth helper is needed in Phase 1; that helper lands with
// Phase 2's first read (deferred deliberately, not forgotten).

'use client';

import DashboardBody from './DashboardBody';

interface DashboardShellProps {
  email: string;
  accountId: string;
}

export default function DashboardShell({ email, accountId }: DashboardShellProps) {
  // Same display-name derivation Header/ChatInterface use.
  const displayName = accountId.split('.')[0];

  // Sign out via the dashboard-logout route, which clears the httpOnly
  // nova_session cookie (Auth0's /auth/logout does not) and THEN routes: email
  // users continue to Auth0 logout, wallet users just return to /. Without
  // clearing nova_session, the cookie-first /app gate would keep rendering a
  // stale wallet session even after signing out / logging in as someone else.
  // `email` present ⇒ email user; empty ⇒ wallet user.
  const handleSignOut = () => {
    const kind = email ? 'email' : 'wallet';
    window.location.href = `/api/auth/dashboard-logout?kind=${kind}`;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#280449]">
      {/* Topbar — identity + sign-out. Distinct from the marketing Header (no
          wallet/login controls); this surface is only reached when already
          authed with a NOVA account. */}
      <header className="bg-[#280449]/90 shadow-sm border-b border-purple-900/50 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <img
            src="/logo-dark.svg"
            alt="NOVA"
            className="w-8 h-8 object-contain"
          />
          <span className="font-museo text-lg font-bold text-white">Dashboard</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-purple-100 max-w-[12rem] truncate" title={accountId}>
              {displayName}
            </span>
            {email && (
              <span className="text-xs text-purple-400 max-w-[12rem] truncate" title={email}>
                {email}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body — Phase 2 mount point (owned + member groups, list→detail). Kept
          intentionally empty of data logic in Phase 1: the milestone here is the
          gated shell itself, provable before any read exists. */}
      <main className="flex-1 flex flex-col items-center px-4 py-10 lg:py-16">
        <div className="w-full max-w-6xl mx-auto">
          <h1 className="font-museo text-2xl md:text-3xl font-black text-white mb-2 tracking-tight">
            Your groups
          </h1>
          <p className="font-space text-purple-300 mb-8">
            Signed in as <span className="text-purple-100">{accountId}</span>.
          </p>
          
          <DashboardBody accountId={accountId} />
        </div>
      </main>
    </div>
  );
}