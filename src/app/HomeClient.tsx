// src/app/HomeClient.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useQuery } from '@tanstack/react-query';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { useWalletState, useWalletSelectorModal } from '@/providers/WalletProvider';

interface HomeClientProps {
  serverUser?: any;  // From server (Auth0 user)
}

export default function HomeClient({ serverUser }: HomeClientProps) {
  const { user: clientUser, isLoading: authLoading } = useUser();  // Client sync
  const user = serverUser || clientUser;  // Prefer server for initial render
  const { isSignedIn, accountId, loading: walletLoading } = useWalletState();
  const { modal } = useWalletSelectorModal();

  const isConnected = !!user && isSignedIn;
  const loading = authLoading || walletLoading;

  // MCP health query
  const { data: mcpStatus } = useQuery({
    queryKey: ['mcp-status'],
    queryFn: async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_MCP_URL}/`);
      if (!res.ok) throw new Error('MCP unavailable');
      return { status: 'ready' };
    },
    enabled: isConnected,
    refetchInterval: 30000,
  });

  const handleConnect = () => {
    if (!user) {
      window.location.href = '/api/auth/login';
    } else if (!isSignedIn) {
      modal?.show();
    }
  };

  return (
    <main className="page-container min-h-screen bg-gray-50 flex flex-col lg:flex-row items-center justify-center p-4 lg:p-8">
      <Header />
      {/* Hero Section */}
      <section className="hero-section flex-1 text-center lg:text-left mb-8 lg:mb-0 lg:pr-8 max-w-md lg:max-w-lg">
        <h2 className="text-4xl md:text-3xl lg:text-5xl font-bold text-gray-900 mb-4">
          Secure Your Data on NEAR
        </h2>
        <p className="text-xl md:text-lg lg:text-xl text-gray-600 mb-6">
          Build privacy-first dApps with group key management and TEEs. Fees to {process.env.NEXT_PUBLIC_CONTRACT_ID}.
        </p>
        <Button
          onClick={handleConnect}
          disabled={loading}
          className="w-full lg:w-auto px-6 py-3 text-lg"
        >
          {loading ? 'Loading...' : !user ? 'Sign Up with Email/Social' : !isSignedIn ? 'Connect Wallet' : 'Connected & Ready'}
        </Button>
      </section>

      {/* Gated Chat Window */}
      <section className="chat-container flex-1 relative max-w-2xl h-64 md:h-80 lg:h-full lg:max-w-4xl rounded-lg overflow-hidden shadow-lg">
        <iframe
          src={
            isConnected
            ? `${process.env.NEXT_PUBLIC_MCP_URL}?token=${user?.accessToken || ''}&near=${accountId || ''}`  // Handle undefined
            : undefined  // No src = no load
          }
          className={clsx(
            'w-full h-full border bg-gray-100 transition-all duration-300 chat-blur',
            !isConnected && 'pointer-events-none'
          )}
          title="NOVA Chat - Secure File Sharing Tools"
        />
        {!isConnected && (  // Overlay only if not connected
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm rounded-lg">
            <MessageSquare size={64} className="text-gray-400 mb-4 animate-pulse" />
            <p className="text-gray-600 mb-4 text-center px-4">Connect to unlock NOVA for confidential file-sharing</p>
            <Button onClick={handleConnect} className="bg-blue-600 text-white px-6 py-2 rounded">
              Get Started
            </Button>
          </div>
        )}
        {mcpStatus && (
          <p className={clsx('absolute bottom-2 right-2 text-xs px-2 py-1 rounded bg-white/50', isConnected ? 'text-green-600' : 'text-gray-400')}>
            MCP: {mcpStatus.status}
          </p>
        )}
      </section>
    </main>
  );
}