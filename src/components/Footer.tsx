// nova-landing/src/components/Footer.tsx
//
// Shared site footer, used by both the marketing page (/) and the dashboard
// (/app) so the two surfaces feel continuous (2e). Extracted verbatim from
// HomeClient's inline footer, plus the network (Mainnet/Testnet) swap — which is
// hidden from the Header on mobile, so the footer is its always-present home on
// every device.
//
// The network swap mirrors Header's logic exactly (NEXT_PUBLIC_NEAR_NETWORK →
// link to the opposite deployment) so the two stay consistent. Note Header's
// existing typo-tolerant check compares against 'testnet'; kept identical here
// on purpose so both controls behave the same until that's fixed in one place.

'use client';

import type { ReactNode } from 'react';

export default function Footer({ rightSlot }: { rightSlot?: ReactNode }) {
  const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK === 'testnet';
  const destinationUrl = isTestnet ? 'https://nova-sdk.com' : 'https://testnet.nova-sdk.com';
  const destinationLabel = isTestnet ? 'Mainnet' : 'Testnet'; // where the link goes

  return (
    <footer className="footer relative w-full bg-[#280449]/90 border-t border-purple-900/50 p-4 text-center text-sm">
      <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2">
        {/* Network swap — a navigation link to the OTHER network. The Header hides
            its pill on mobile, so this lives here for all devices. Label + color
            reflect the DESTINATION: on mainnet it points to Testnet (purple), on
            testnet it points to Mainnet (green). */}
        <a
          href={destinationUrl}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            isTestnet
              ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/50'
              : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/50'
          }`}
          title={`Switch to ${destinationLabel}`}
        >
          <span className={`w-2 h-2 rounded-full ${isTestnet ? 'bg-green-400' : 'bg-purple-400'}`} />
          {destinationLabel}
        </a>

        <a
          href="https://civictech-ou.gitbook.io/nova-docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-purple-300 transition-colors text-purple-200"
        >
          Docs
        </a>
        <a
          href="https://github.com/jcarbonnell/nova"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-purple-300 transition-colors text-purple-200"
        >
          GitHub
        </a>
        <a
          href="https://t.me/nova_sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-purple-300 transition-colors text-purple-200"
        >
          Contact
        </a>
        <a
          href="https://x.com/nova_sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-purple-300 transition-colors text-purple-200"
        >
          X
        </a>
      </div>
      <p className="mt-2 text-purple-300">&copy; 2026 CivicTech OÜ. All rights reserved.</p>

      {rightSlot && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2">{rightSlot}</div>
      )}
    </footer>
  );
}