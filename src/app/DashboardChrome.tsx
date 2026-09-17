// src/app/DashboardChrome.tsx
//
// Shared /app chrome — topbar (logo + identity + logout) + themed body wrapper +
// footer (with the theme toggle). Extracted from DashboardShell (§8 step 2a-0) so
// every /app route (Files, Account, later Chat) renders ONE chrome definition
// rather than copies that drift. Takes identity as plain props + children for the
// section body; owns the theme-toggle state (the only client concern here).

'use client';

import { useState, useEffect, type ReactNode } from 'react';
import Footer from '@/components/Footer';
import DashboardNav from './DashboardNav';

interface DashboardChromeProps {
  email: string;
  accountId: string;
  children: ReactNode;
}

export default function DashboardChrome({ email, accountId, children }: DashboardChromeProps) {
  const displayName = accountId.split('.')[0];

  const handleSignOut = () => {
    const kind = email ? 'email' : 'wallet';
    window.location.href = `/api/auth/dashboard-logout?kind=${kind}`;
  };

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const cur = document.documentElement.getAttribute('data-nova-theme');
    setTheme(cur === 'light' ? 'light' : 'dark');
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-nova-theme', next);
    document.cookie = `nova-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  };

  return (
    <div className="flex flex-col min-h-screen bg-nova-bg text-nova-text">
      <header className="bg-nova-surface shadow-sm border-b border-nova-border px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-50 backdrop-blur-sm">
        <a href="/" className="flex items-center shrink-0" title="NOVA home" aria-label="NOVA home">
          <img
            src={theme === 'light' ? '/logo.svg' : '/logo-dark.svg'}
            alt="NOVA"
            className="h-8 w-auto object-contain"
          />
        </a>

        {/* Centered section tabs (desktop) / hamburger (mobile) */}
        <div className="flex-1 flex justify-center">
          <DashboardNav />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-nova-text max-w-[12rem] truncate" title={accountId}>
              {displayName}
            </span>
            {email && (
              <span className="text-xs text-nova-text-dim max-w-[12rem] truncate" title={email}>
                {email}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-10 lg:py-16">
        <div className="w-full max-w-6xl mx-auto">
          {children}
        </div>
      </main>

      <Footer
        themed
        rightSlot={
          <button
            type="button"
            onClick={toggleTheme}
            className="text-xs font-mono px-2 py-1 rounded border border-nova-border text-nova-text-dim hover:text-nova-text transition-colors"
            title="Toggle theme"
          >
            {theme === 'light' ? 'dark' : 'light'}
          </button>
        }
      />
    </div>
  );
}