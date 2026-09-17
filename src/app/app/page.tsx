// nova-landing/src/app/app/page.tsx
//
// §8 step 3 slice 4 — the /app hub. Was a gated redirect (slice 2); now the
// overview/menu landing per the revised D1: four cards (Account, Files, Chat,
// Dev resources) routing into the console, 2×2 on desktop/tablet, 1×4 on mobile.
// The logo (DashboardChrome) now points here, so this is "home" for a signed-in
// user; the top tabs remain the fast path between sections.
//
// Gate unchanged (requireNovaIdentity → redirect('/') if unauth). Chat card is
// disabled ("soon") until step 4 builds /app/chat, mirroring the nav tab.
// Minimal copy — iterate later.

import { requireNovaIdentity } from '@/lib/require-identity';
import DashboardChrome from '../DashboardChrome';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HubCard {
  label: string;
  desc: string;
  href: string;
  external?: boolean;
  disabled?: boolean;
}

const CARDS: HubCard[] = [
  { label: 'Account', desc: 'Manage your API key and NEAR credits.', href: '/app/account' },
  { label: 'Files', desc: 'Browse your groups, inspect files, and verify integrity.', href: '/app/files' },
  { label: 'Chat', desc: 'Talk to your encrypted memory.', href: '/app/chat', disabled: true },
  { label: 'Dev resources', desc: 'SDKs, API reference, and integration guides.', href: 'https://civictech-ou.gitbook.io/nova-docs/', external: true },
];

export default async function AppHubPage() {
  const { email, accountId } = await requireNovaIdentity();
  const displayName = accountId.split('.')[0];

  return (
    <DashboardChrome email={email} accountId={accountId}>
      <h1 className="font-museo text-2xl md:text-3xl font-black text-nova-text mb-2 tracking-tight">
        Welcome, {displayName}
      </h1>
      <p className="font-space text-nova-text-dim mb-8">
        Your NOVA console — pick where to go.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CARDS.map((card) => {
          const inner = (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-museo text-lg font-bold text-nova-text">{card.label}</span>
                {card.disabled && (
                  <span className="text-[10px] uppercase tracking-wide text-nova-text-dim/60">soon</span>
                )}
                {card.external && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-nova-text-dim"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                )}
              </div>
              <p className="font-space text-sm text-nova-text-dim">{card.desc}</p>
            </>
          );

          const base = 'block rounded-xl border p-5 transition-colors';

          if (card.disabled) {
            return (
              <div key={card.label} className={`${base} border-nova-border bg-nova-surface-2 opacity-60 cursor-not-allowed`}>
                {inner}
              </div>
            );
          }

          if (card.external) {
            return (
              <a key={card.label} href={card.href} target="_blank" rel="noopener noreferrer" className={`${base} border-nova-border bg-nova-surface hover:bg-nova-surface-2`}>
                {inner}
              </a>
            );
          }

          return (
            <a key={card.label} href={card.href} className={`${base} border-nova-border bg-nova-surface hover:bg-nova-surface-2`}>
              {inner}
            </a>
          );
        })}
      </div>
    </DashboardChrome>
  );
}