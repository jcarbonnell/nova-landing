// src/components/Providers.tsx
'use client';
import { UserProvider } from '@auth0/nextjs-auth0/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NearWalletProvider } from '@/providers/WalletProvider';
import type { ReactNode } from 'react';

const queryClient = new QueryClient();  // Instantiate here (client-only)

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <UserProvider>
      <NearWalletProvider>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </NearWalletProvider>
    </UserProvider>
  );
}