// src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';
import { Auth0Provider } from '@auth0/nextjs-auth0/client';

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
    connect-src 'self' https://*.auth0.com https://auth0.com https://*.near.org https://rpc.testnet.near.org https://*.nearblocks.io;
    img-src 'self' data: https: blob:;
    font-src 'self' https:;
    frame-src 'self' https://*.auth0.com https://walletselector.com;
    worker-src 'self' blob:;
  `.replace(/\s{2,}/g, ' ').trim();

  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
      </head>
      <body>
        <Auth0Provider>
          <Providers>
            {children}
            <div id="wallet-selector-root" className="fixed inset-0 pointer-events-none z-[1300]" />
          </Providers>
        </Auth0Provider>
      </body>
    </html>
  );
}