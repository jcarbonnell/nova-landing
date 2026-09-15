// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import { MuseoModerno, Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';

const museoModerno = MuseoModerno({ 
  subsets: ['latin'],
  weight: ['700', '900'],
  variable: '--font-museo'
});

const spaceGrotesk = Space_Grotesk({ 
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-space'
});

// Dashboard data font
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-loader',
});

export const metadata: Metadata = {
  title: 'NOVA - Shared memory for AI agents.',
  description: 'NOVA is a permissioned memory layer for AI agents: encrypted, auditable, and self-sovereign.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const csp = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.auth0.com https://auth0.com;
    style-src 'self' 'unsafe-inline';
    connect-src 'self' https://*.auth0.com https://auth0.com https://*.near.org https://rpc.mainnet.near.org https://rpc.testnet.near.org https://*.nearblocks.io https://relayer.mainnet.near.org https://relayer.testnet.near.org;
    img-src 'self' data: https: blob:;
    font-src 'self' https:;
    frame-src 'self' https://*.auth0.com https://walletselector.com;
    worker-src 'self' blob:;
  `.replace(/\s{2,}/g, ' ').trim();

  return (
    <html
      lang="en"
      className={`${museoModerno.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        {/* No-flash dashboard theme: set data-nova-theme on <html> BEFORE paint,
            from the nova-theme cookie, falling back to prefers-color-scheme.
            Marketing ignores --nova-* tokens, so this is inert on /. Runs once,
            pre-hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=document.cookie.match(/(?:^|; )nova-theme=(dark|light)/);var t=m?m[1]:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-nova-theme',t);}catch(e){document.documentElement.setAttribute('data-nova-theme','dark');}})();`,
          }}
        />
      </head>
      <body>
          <Providers>
            {children}
            <div id="wallet-selector-root" className="fixed inset-0 pointer-events-none z-[1300]" />
          </Providers>
      </body>
    </html>
  );
}