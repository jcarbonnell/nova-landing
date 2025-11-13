// src/app/HomeClient.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';  // Add useQueryClient
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { useWalletState, useWalletSelectorModal } from '@/providers/WalletProvider';
import type { User } from '@/lib/auth0';
import Image from 'next/image';

interface HomeClientProps {
  serverUser?: User | null;  // Explicit User type (or null for unauth)
}

export default function HomeClient({ serverUser }: HomeClientProps) {
  const { user: clientUser, isLoading: authLoading } = useUser();
  const user = serverUser || clientUser;
  const { isSignedIn, accountId, loading: walletLoading } = useWalletState();
  const { modal } = useWalletSelectorModal();
  const queryClient = useQueryClient();  // Add: For retry

  const isConnected = !!user && isSignedIn;
  const loading = authLoading || walletLoading;

  // MCP health query (via proxy to avoid CORS)
  const { data: mcpStatus, error: mcpError } = useQuery({
    queryKey: ['mcp-status'],
    queryFn: async () => {
      const res = await fetch('/api/mcp-proxy');  // Proxied GET to MCP root (no trailing /)
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`MCP error: ${res.status} - ${errorText.slice(0, 100)}`);  // Truncate for UI
      }
      return res.json();  // { status: 'ready' } from health endpoint
    },
    enabled: isConnected,
    retry: 1,
    refetchInterval: 30000,
  });

  const handleConnect = () => {
    if (!user) {
      window.location.href = '/api/auth/login?returnTo=/';
      return;
    } else if (!isSignedIn) {
      if (modal) {
        modal.show();
      } else {
        console.error('Modal unavailable—reloading provider');
        window.location.reload();
      }
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#280449]"> {/* Wrapper for flex-col + footer sticky */}
      <Header />
      <main className="flex-1 flex items-center justify-center p-4 lg:p-8"> {/* flex-1 for content push */}
        <div className="page-container w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-center"> {/* Added w-full/max-w for bounds */}
          {/* Hero Section */}
          <section className="hero-section flex-1 text-center lg:text-left mb-8 lg:mb-0 lg:pr-8 max-w-md lg:max-w-lg">
            <div className="flex justify-center lg:justify-start mb-6 lg:mb-8">
            <Image
              src="/nova-logo.png"
              alt="NOVA - Secure File Sharing"
              width={192}  // Base width for optimization; classes override for responsive
              height={192}
              className="w-40 h-40 lg:w-48 lg:h-48 object-contain drop-shadow-md hover:drop-shadow-xl transition-all duration-300 hover:scale-105"  // Bigger base, extra hover scale for pop
              priority
            />
          </div>  
          <h2 className="text-4xl md:text-3xl lg:text-5xl font-bold text-white mb-4">
            Secure File Sharing for User-Owned AI
          </h2>
          <p className="text-xl md:text-lg lg:text-xl text-purple-200 mb-6">
            NOVA is a privacy-first, decentralized file-sharing primitive, enabling encrypted data persistence for the latest AI technologies (TEEs, Intents, Shade Agents...).
          </p>
          </section>
          {/* Gated Chat Window */}
          <section className="chat-container flex-1 relative max-w-2xl h-64 md:h-80 lg:h-full lg:max-w-4xl rounded-lg overflow-hidden shadow-lg">
            {isConnected ? (
              <iframe
                key="mcp-frame"  // Add key: Forces remount on connect
                src={`/api/mcp-proxy?token=${encodeURIComponent((clientUser?.accessToken as string) || '')}&near=${encodeURIComponent(accountId || '')}`}
                className="w-full h-full border border-purple-600/50 bg-[#280449]/50 transition-all duration-300 p-4 connected"
                title="NOVA Chat - Secure File Sharing Tools"
                sandbox="allow-scripts allow-popups allow-forms"
                referrerPolicy="origin-when-cross-origin"
                style={{ display: 'block' }}  // Explicit: No null origin
              />
            ) : null}  {/* Conditional mount: No iframe if !connected—no load/405/X-Frame */}
            
            {/* Overlay (fades out on connect) */}
            <div className={clsx(
              "absolute inset-0 flex flex-col items-center justify-center bg-[#280449]/80 backdrop-blur-sm rounded-lg transition-opacity duration-300",
              isConnected ? "opacity-0 pointer-events-none" : "opacity-100"  // Fade/hide on connect
            )}>
              <MessageSquare size={64} className="text-gray-400 mb-4 animate-pulse" />
              <p className="text-purple-200 mb-4 text-center px-4">Connect to unlock NOVA for confidential file-sharing</p>
              <Button onClick={handleConnect} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded">
                Get Started
              </Button>
            </div>
            
            {/* Status Badge (only if connected) */}
            {isConnected && mcpStatus && (
              <p className={clsx(
                'absolute bottom-2 right-2 text-xs px-2 py-1 rounded bg-white/50',
                mcpStatus.status === 'ready' ? 'text-green-600' : 'text-red-400'
              )}>
                MCP: {mcpStatus.status || 'error'}
              </p>
            )}
            
            {/* Error Overlay (shows on mcpError, over iframe if connected) */}
            {mcpError && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 text-red-400 text-sm p-4 rounded z-10">
                {mcpError.message} -{' '}
                <button 
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['mcp-status'] })} 
                  className="underline ml-1 hover:text-red-300"
                >
                  Retry
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
      {/* Footer */}
      <footer className="footer w-full bg-[#280449]/90 border-t border-purple-900/50 p-4 text-center text-sm">
        <div className="flex justify-center space-x-6">
          <a href="https://nova-25.gitbook.io/nova-docs/" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            Documentation
          </a>
          <a href="https://github.com/jcarbonnell/nova" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            GitHub
          </a>
          <a href="https://x.com/nova_sdk" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            X
          </a>
        </div>
        <p className="mt-2 text-purple-300">&copy; 2025 CivicTech OÜ. All rights reserved.</p>
      </footer>
    </div>
  );
}