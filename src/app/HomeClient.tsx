// src/app/homeclient.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { useWalletState, useWalletSelectorModal } from '@/providers/WalletProvider';
import type { User } from '@/lib/auth0';
import Image from 'next/image';
import LoginModal from '../components/LoginModal';
import CreateAccountModal from '../components/CreateAccountModal';
import PaymentModal from '../components/PaymentModal';

interface HomeClientProps {
  serverUser?: User | null;
}

export default function HomeClient({ serverUser }: HomeClientProps) {
  const { user: clientUser, isLoading: authLoading } = useUser();
  const user = serverUser || clientUser;
  const { isSignedIn, accountId, loading: walletLoading } = useWalletState();
  const { modal } = useWalletSelectorModal();
  const queryClient = useQueryClient();

  const isConnected = isSignedIn && !!accountId;
  const loading = authLoading || walletLoading;

  // States for modal flow
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const [userData, setUserData] = useState<{ email: string; publicKey?: string } | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [error, setError] = useState('');

  // MCP health query
  const { data: mcpStatus, error: mcpError } = useQuery({
    queryKey: ['mcp-status'],
    queryFn: async () => {
      const res = await fetch('/api/mcp-proxy');
      if (!res.ok) throw new Error(`MCP error: ${res.status}`);
      return res.json();
    },
    enabled: isConnected,
    retry: 1,
    refetchInterval: 30000,
  });

  const checkExistingAccount = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch('/api/auth/check-for-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      if (!res.ok) throw new Error('Check failed');
      const { exists, accountId: existingId } = await res.json();
      if (exists) {
        setWelcomeMessage(`Welcome back! Account ${existingId} ready.`);
      } else {
        setUserData({ email: user.email });
        setIsCreateOpen(true);
      }
    } catch (err) {
      setError(`Account check failed: ${(err as Error).message}`);
    }
  }, [user?.email]);

  // Check for existing account on auth change
  useEffect(() => {
    if (user && !loading && isSignedIn && !accountId) {
      checkExistingAccount();
    }
  }, [user, loading, isSignedIn, accountId, checkExistingAccount]);  // Added checkExistingAccount

  // logout message
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('loggedOut') === '1') {
      setWelcomeMessage('Successfully logged out 👋');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // reload client-side after server-side redirect
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    
    // Auth0 OAuth callback
    const isAuth0Callback = params.has('code') || params.has('state');
    // MCP server callback
    const isMcpCallback = params.has('token');
    
    if (isAuth0Callback || isMcpCallback) {
      // Clean reload without keeping query params
      window.location.replace(window.location.origin + window.location.pathname);
    }
  }, []);

  // handleLoginSuccess (from modal callback)
  const handleLoginSuccess = () => {
    setIsLoginOpen(false);
  };

  // handleAccountCreated (from create modal)
  const handleAccountCreated = (newAccountId: string) => {
    setIsCreateOpen(false);
    setWelcomeMessage(`Account ${newAccountId} created! You can now use NOVA.`);
    if (modal) {
      setTimeout(() => {
        modal.show();
      }, 1500);
    }
  };

  // handlePayment (from payment modal)
  const handlePayment = async (sessionId: string, amount: string) => {
    try {
      const res = await fetch('/api/auth/fund-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, amount, accountId: pendingId }),
      });
      if (!res.ok) throw new Error('Funding failed');

      const { fundedAmountNear, txHash } = await res.json();
      setWelcomeMessage(`Funded ${fundedAmountNear} NEAR (tx: ${txHash})!`);
      setIsPaymentOpen(false);
      // Proceed to create
      await createAccount(pendingId);
    } catch (err) {
      setError(`Funding error: ${(err as Error).message}`);
    }
  };

  // skip payments
  const handleSkipPayment = () => {
    setIsPaymentOpen(false);
    createAccount(pendingId);
  };

  // createAccount (calls API)
  const createAccount = async (fullId: string) => {
    try {
      const res = await fetch('/api/auth/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: fullId.split('.')[0], 
          email: userData?.email 
        }),
      });
      if (!res.ok) throw new Error('Creation failed');

      const { accountId } = await res.json();
      handleAccountCreated(accountId);
    } catch (err) {
      setError(`Creation error: ${(err as Error).message}`);
    }
  };

  const handleConnect = () => {
    if (!user) {
      setIsLoginOpen(true);
    } else if (!isSignedIn) {
      if (modal) modal.show();
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#280449]">
      <Header onOpenLogin={() => setIsLoginOpen(true)} /> 
      
      {welcomeMessage && (
        <div className="p-4 text-center text-green-400 bg-green-500/20 border-b border-green-400/30">
          {welcomeMessage}
        </div>
      )}
      {error && (
        <div className="p-4 text-center text-red-400 bg-red-500/20 border-b border-red-400/30">
          {error} {' '}
          <Button variant="ghost" size="sm" onClick={() => setError('')}>
            Dismiss
          </Button>
        </div>
      )}

      <main className="flex-1 flex items-center justify-center p-4 lg:p-8">
        <div className="page-container w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-center">
          {/* Hero */}
          <section className="hero-section flex-1 text-center lg:text-left mb-8 lg:mb-0 lg:pr-8 max-w-md lg:max-w-lg">
            <div className="flex justify-center lg:justify-start mb-6 lg:mb-8">
              <Image
                src="/nova-logo.png"
                alt="NOVA - Secure File Sharing"
                width={192}
                height={79}
                className="w-40 h-40 lg:w-48 lg:h-48 object-contain drop-shadow-md hover:drop-shadow-xl transition-all duration-300 hover:scale-105"
                priority
              />
            </div>
            <h2 className="text-4xl md:text-3xl lg:text-5xl font-bold text-white mb-4">
              Secure File Sharing for User-Owned AI
            </h2>
            <p className="text-xl md:text-lg lg:text-xl text-purple-200 mb-6">
              NOVA is a privacy-first, decentralized file-sharing primitive, empowering user-owned AI at scale with encrypted data persistence.
            </p>
          </section>

          {/* Gated Chat - only render when connected */}
          <section className="chat-container flex-1 relative max-w-2xl h-64 md:h-80 lg:h-full sm:h-96 mobile:h-[500px] lg:max-w-4xl rounded-lg overflow-hidden shadow-lg">
            {isConnected && (
              <iframe
                key="mcp-frame"
                src={`/api/mcp-proxy?near=${encodeURIComponent(accountId || '')}`}
                className="w-full h-full border border-purple-600/50 bg-[#280449]/50 transition-all duration-300 p-4 connected"
                title="NOVA - Secure File Sharing"
                sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
                referrerPolicy="origin-when-cross-origin"
              />
            )}

            {/* MCP loading spinner (shows only while mcpStatus is undefined or loading) */}
            {isConnected && !mcpStatus && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#280449]/90 z-20">
                <div className="flex flex-col items-center gap-4">
                  <div className="animate-spin rounded-full h-14 w-14 border-4 border-purple-500 border-t-transparent" />
                  <p className="text-purple-300 text-sm">Loading NOVA chat…</p>
                </div>
              </div>
            )}

            {/* MCP error overlay */}
            {isConnected && mcpError && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-900/60 z-20">
                <div className="text-center">
                  <p className="text-red-300 mb-3">Chat unavailable</p>
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['mcp-status'] })}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Blur overlay when not connected */}
            <div className={clsx(
              "absolute inset-0 flex flex-col items-center justify-center bg-[#280449]/80 backdrop-blur-sm rounded-lg transition-opacity duration-300",
              isConnected ? "opacity-0 pointer-events-none" : "opacity-100"
            )}>
              <MessageSquare size={64} className="text-gray-400 mb-4 animate-pulse" />
              <p className="text-purple-200 mb-4 text-center px-4">
                Connect to unlock secure file-sharing
              </p>
              <Button onClick={handleConnect} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded">
                Get Started
              </Button>
            </div>

            {/* MCP status badge */}
            {isConnected && mcpStatus && (
              <p className={clsx(
                'absolute bottom-2 right-2 text-xs px-2 py-1 rounded bg-white/50',
                mcpStatus.status === 'ready' ? 'text-green-600' : 'text-red-400'
              )}>
                MCP: {mcpStatus.status || 'error'}
              </p>
            )}
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

      {/* Modals */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        onOpenWallet={modal ? () => modal.show() : undefined}
      />
      <CreateAccountModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onAccountCreated={handleAccountCreated}
        userData={userData}
        onPaymentOpen={(id: string) => { setPendingId(id); setIsPaymentOpen(true); }}
      />
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onSubmit={handlePayment}
        onSkip={handleSkipPayment}
        accountId={pendingId}
        email={userData?.email || ''}
      />
    </div>
  );
}