// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import { MuseoModerno, Space_Grotesk } from 'next/font/google';

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

export const metadata: Metadata = {
  title: 'NOVA - Your data. Your vault. Your rules.',
  description: 'NOVA is a privacy-first, decentralized file-sharing primitive, empowering user-owned AI with encrypted data persistence.',
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
    <html lang="en" className={`${museoModerno.variable} ${spaceGrotesk.variable}`}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
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