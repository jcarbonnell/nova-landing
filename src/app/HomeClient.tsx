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
  const { user: clientUser, isLoading: authLoading } = useUser();
  const user = serverUser || clientUser;
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
      window.location.href = '/api/auth/login';  // Server-side redirect
    } else if (!isSignedIn) {
      modal?.show();
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#280449]"> {/* Wrapper for flex-col + footer sticky */}
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 lg:p-8"> {/* flex-1 for content push */}
        <div className="page-container w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-center"> {/* Added w-full/max-w for bounds */}
          {/* Hero Section */}
          <section className="hero-section flex-1 text-center lg:text-left mb-8 lg:mb-0 lg:pr-8 max-w-md lg:max-w-lg">
            <h2 className="text-4xl md:text-3xl lg:text-5xl font-bold text-white mb-4">
              Confidential File Sharing System
            </h2>
            <p className="text-xl md:text-lg lg:text-xl text-purple-200 mb-6">
              NOVA is a privacy-first, decentralized file-sharing primitive, empowering user-owned AI at scale. 
            </p>
            <Button
              onClick={handleConnect}
              disabled={loading}
              className="w-full lg:w-auto px-6 py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white"
            >
              {loading ? 'Loading...' : !user ? 'Sign Up with Email/Social' : !isSignedIn ? 'Connect Wallet' : 'Connected & Ready'}
            </Button>
          </section>

          {/* Gated Chat Window */}
          <section className="chat-container flex-1 relative max-w-2xl h-64 md:h-80 lg:h-full lg:max-w-4xl rounded-lg overflow-hidden shadow-lg">
            <iframe
              src={
                isConnected
                ? `${process.env.NEXT_PUBLIC_MCP_URL}?token=${user?.accessToken || ''}&near=${accountId || ''}`
                : undefined  // No src = no load
              }
              className={clsx(
                'w-full h-full border border-purple-600/50 bg-[#280449]/50 transition-all duration-300 chat-blur p-4',
                !isConnected && 'pointer-events-none',
                isConnected && 'connected' // For CSS targeting
              )}
              title="NOVA Chat - Secure File Sharing Tools"
            />
            {!isConnected && (  // Overlay only if not connected
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#280449]/80 backdrop-blur-sm rounded-lg">
                <MessageSquare size={64} className="text-gray-400 mb-4 animate-pulse" />
                <p className="text-purple-200 mb-4 text-center px-4">Connect to unlock NOVA for confidential file-sharing</p>
                <Button onClick={handleConnect} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded">
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
        </div>
      </main>
      {/* Footer */}
      <footer className="footer w-full bg-[#280449]/90 border-t border-purple-900/50 p-4 text-center text-sm">
        <div className="flex justify-center space-x-6">
          <a href="https://x.com/nova_sdk" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            X
          </a>
          <a href="https://github.com/jcarbonnell/nova" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            GitHub
          </a>
          <a href="https://nova-25.gitbook.io/nova-docs/" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            Documentation
          </a>
        </div>
        <p className="mt-2 text-purple-300">&copy; 2025 CivicTech OÜ. All rights reserved.</p>
      </footer>
    </div>
  );
}