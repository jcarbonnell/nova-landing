// src/app/DashboardNav.tsx
//
// §8 step 3 — the section nav (Chat · Files · Account). Centered tabs in the
// topbar on desktop/tablet; collapses to a hamburger + dropdown on mobile.
// Mounted inside DashboardChrome, so every /app section (and the slice-4 hub)
// inherits it. Active tab is derived from the pathname.
//
// Chat is rendered DISABLED ("soon") until §8 step 4 builds /app/chat — showing
// the tab communicates the console's shape; disabling it is honest. Files +
// Account are live links.

'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  disabled?: boolean;
}

const ITEMS: NavItem[] = [
  { label: 'Chat', href: '/app/chat', disabled: true },
  { label: 'Files', href: '/app/files' },
  { label: 'Account', href: '/app/account' },
];

function isActive(pathname: string, href: string): boolean {
  // exact, or a sub-path (e.g. /app/files/... keeps Files active)
  return pathname === href || pathname.startsWith(href + '/');
}

export default function DashboardNav() {
  const pathname = usePathname() || '';
  const [menuOpen, setMenuOpen] = useState(false);

  const linkClasses = (item: NavItem) => {
    if (item.disabled) {
      return 'text-nova-text-dim/50 cursor-not-allowed';
    }
    return isActive(pathname, item.href)
      ? 'text-nova-text border-b-2 border-nova-purple'
      : 'text-nova-text-dim hover:text-nova-text border-b-2 border-transparent';
  };

  return (
    <>
      {/* Desktop / tablet: centered tabs */}
      <nav className="hidden md:flex items-center gap-6">
        {ITEMS.map((item) =>
          item.disabled ? (
            <span
              key={item.href}
              className={`text-sm font-medium pb-1 ${linkClasses(item)}`}
              title="Coming soon"
            >
              {item.label}
              <span className="ml-1 text-[10px] uppercase tracking-wide">soon</span>
            </span>
          ) : (
            <a
              key={item.href}
              href={item.href}
              className={`text-sm font-medium pb-1 transition-colors ${linkClasses(item)}`}
            >
              {item.label}
            </a>
          ),
        )}
      </nav>

      {/* Mobile: hamburger + dropdown */}
      <div className="md:hidden relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="p-2 text-nova-text-dim hover:text-nova-text"
          aria-label="Open section menu"
          aria-expanded={menuOpen}
        >
          {/* simple hamburger / close glyph */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {menuOpen ? (
              <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
            ) : (
              <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>
            )}
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-40 rounded-lg border border-nova-border bg-nova-surface shadow-lg py-1 z-50">
            {ITEMS.map((item) =>
              item.disabled ? (
                <span
                  key={item.href}
                  className="block px-4 py-2 text-sm text-nova-text-dim/50 cursor-not-allowed"
                >
                  {item.label} <span className="text-[10px] uppercase">soon</span>
                </span>
              ) : (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    isActive(pathname, item.href)
                      ? 'text-nova-text bg-nova-surface-2'
                      : 'text-nova-text-dim hover:text-nova-text hover:bg-nova-surface-2'
                  }`}
                >
                  {item.label}
                </a>
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
}