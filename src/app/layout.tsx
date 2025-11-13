// src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NOVA - Your data. Your vault. Your rules.',
  description: 'Secure file sharing on NEAR with privacy-first AI tools.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Same CSP string as middleware (duplicate for fallback)
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
        <meta http-equiv="Content-Security-Policy" content={csp} />
      </head>
      <body className={inter.className}>
        <Providers>  {/* Wrap here: Server renders placeholder, client hydrates */}
          {children}
        </Providers>
      </body>
    </html>
  );
}