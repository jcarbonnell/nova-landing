// src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Providers from '@/components/Providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NOVA - Your data. Your vault. Your rules.',
  description: 'Secure file sharing on NEAR with privacy-first AI tools.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>  {/* Wrap here: Server renders placeholder, client hydrates */}
          {children}
        </Providers>
      </body>
    </html>
  );
}