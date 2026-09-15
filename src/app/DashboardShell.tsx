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

  // TEMPORARY theme toggle for the build-and-judge loop. Flips data-nova-theme on
  // <html> + persists the nova-theme cookie. The REAL toggle lands in the Account
  // section (§8); REMOVE this block + the button below when that ships.
  const toggleTheme = () => {
    const cur = document.documentElement.getAttribute('data-nova-theme') === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-nova-theme', next);
    document.cookie = `nova-theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--nova-bg)] text-[var(--nova-text)]">
      {/* Topbar — identity + sign-out. Distinct from the marketing Header (no
          wallet/login controls); this surface is only reached when already
          authed with a NOVA account. */}
      <header className="bg-[#280449]/90 shadow-sm border-b border-purple-900/50 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-50 backdrop-blur-sm">
        {/* Logo → homepage. The /app side of the two-way link (/ has a Dashboard
            link; /app's logo returns home). "Dashboard" text removed — redundant
            here and it collided with the logo. */}
        <a href="/" className="flex items-center shrink-0" title="NOVA home" aria-label="NOVA home">
          <img
            src="/logo-dark.svg"
            alt="NOVA"
            className="h-8 w-auto object-contain"
          />
        </a>

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
          {/* TEMPORARY — remove when the Account-section theme toggle ships (§8). */}
          <button
            type="button"
            onClick={toggleTheme}
            className="text-xs font-mono px-2 py-1 rounded border border-[var(--nova-border)] text-[var(--nova-text-dim)] hover:text-[var(--nova-text)] transition-colors"
            title="Toggle theme (temporary)"
          >
            theme
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            Logout
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