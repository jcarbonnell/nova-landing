// src/components/Providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NearWalletProvider } from '@/providers/WalletProvider';
import type { ReactNode } from 'react';

const queryClient = new QueryClient();

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <NearWalletProvider>
        {children}
      </NearWalletProvider>
    </QueryClientProvider>
  );
}