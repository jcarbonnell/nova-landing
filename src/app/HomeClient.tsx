// src/app/homeclient.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import ChatInterface from '@/components/ChatInterface';
import { MessageSquare } from 'lucide-react';
import { useWalletState, useWalletSelector, useWalletSelectorModal } from '@/providers/WalletProvider';
import type { User } from '@/lib/auth0';
import { connectWithPrivateKey } from '@/lib/nearWallet';
import { useWalletSignin } from '@/hooks/useWalletSignin';
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
  const { isSignedIn, accountId, loading: walletLoading, setOnWalletConnect } = useWalletState();
  const { modal } = useWalletSelectorModal();
  // Handle Auth0 email users (existing flow, simplified)
  const selector = useWalletSelector();
  const { signIn: walletSignIn, error: walletError } = useWalletSignin(selector);

  const isConnected = isSignedIn && !!accountId;
  const loading = authLoading || walletLoading;

  // States for modal flow
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const [userData, setUserData] = useState<{ email: string; publicKey?: string; wallet_id?: string } | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [error, setError] = useState('');

  // Email-flow gate (custodial). Wallet users don't use this — SIWN drives their
  // signed-in state directly through the selector.
  const [novaAccountVerified, setNovaAccountVerified] = useState(false);

  // Auto sign-in for EMAIL users (custodial, unchanged). Wallet users never
  // reach this — they sign in via SIWN (walletSignIn) and NOVA never holds
  // their key. The wallet branch (retrieve-key + connectWithPrivateKey +
  // __forceWalletConnect substitution) is removed.
  const autoSignInWithNovaAccount = useCallback(async (
    novaAccountId: string,
    userEmail?: string,
  ) => {
    try {
      const keyRes = await fetch('/api/auth/retrieve-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: novaAccountId, email: userEmail }),
      });

      if (!keyRes.ok) {
        setNovaAccountVerified(true);
        return;
      }

      const { private_key } = await keyRes.json();
      if (!private_key) {
        setNovaAccountVerified(true);
        return;
      }

      await connectWithPrivateKey(private_key, novaAccountId);
      (window as any).__forceWalletConnect?.(novaAccountId);

      const displayName = novaAccountId.split('.')[0];
      setWelcomeMessage(`Signed in as ${displayName}!`);
      setNovaAccountVerified(true);
      setTimeout(() => setWelcomeMessage(''), 4000);
    } catch {
      console.error('Auto sign-in failed');
      setNovaAccountVerified(true);
    }
  }, []);

  // Handle new wallet connection (from wallet selector modal).
  // SIWN: the connected wallet signs a NEP-413 challenge; wallet-verify sets the
  // nova_session httpOnly cookie. No custodial substitution, no key retrieval.
  const handleWalletConnect = useCallback(async () => {
    const result = await walletSignIn();
    if (result) {
      const displayName = result.account_id.split('.')[0];
      setWelcomeMessage(`Signed in as ${displayName}!`);
      setTimeout(() => setWelcomeMessage(''), 4000);
    }
    // On failure, walletError surfaces the reason (rendered in the banner).
  }, [walletSignIn]);

  // Register wallet connect callback. WalletProvider invokes this when a NEW
  // wallet connection is detected; we ignore its accountId arg and trigger SIWN
  // for the just-connected wallet.
  useEffect(() => {
    if (setOnWalletConnect) {
      setOnWalletConnect(() => handleWalletConnect());
      return () => setOnWalletConnect(undefined);
    }
  }, [setOnWalletConnect, handleWalletConnect]);
  
  const handleEmailUserFlow = useCallback(async () => {
    // Skip if payment flow is active
    if (isPaymentOpen) {
      return;
    }

    if (!user?.email || isSignedIn) return;
    
    try {
      // Verify session
      const sessionRes = await fetch('/auth/profile');

      // 204 means no session (wallet user or logged out) - not an error
      if (sessionRes.status === 204) {
        return;
      }

      if (!sessionRes.ok) {
        setIsLoginOpen(true);
        return;
      }
      
      // Check for existing account
      const checkRes = await fetch('/api/auth/check-for-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });

      if (!checkRes.ok) {
        return;
      }

      const { exists, accountId: existingId } = await checkRes.json();

      if (exists && existingId) {
        // Auto sign-in
        await autoSignInWithNovaAccount(existingId, user.email);
      } else {
        // New user - show account creation
        setUserData({ email: user.email });
        setIsCreateOpen(true);
      }
    } catch {
      console.error('Email user flow failed');
    }
  }, [user?.email, isSignedIn, autoSignInWithNovaAccount, isPaymentOpen]);

  // Trigger email user flow when user is loaded but wallet not connected
  useEffect(() => {
    // Skip if payment flow is active
    if (isPaymentOpen) return;

    if (!loading && user?.email && !isSignedIn && !novaAccountVerified) {
      handleEmailUserFlow();
    }
  }, [loading, user?.email, isSignedIn, novaAccountVerified, handleEmailUserFlow, isPaymentOpen]);

  // logout message
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('loggedOut') === '1') {
      setWelcomeMessage('Successfully logged out.');
      setNovaAccountVerified(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // reload client-side after server-side redirect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isPaymentOpen) return;

    const params = new URLSearchParams(window.location.search);
    const isCallback = params.has("code") || params.has("state") || params.has("token") || params.has("near");
    
    if (isCallback) {
      window.history.replaceState({}, "", "/");
      setNovaAccountVerified(false);
      window.location.href = "/";
    }
  }, [isPaymentOpen]);

  // fallback timeout
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPaymentOpen) return;

    const timer = setTimeout(() => {
      if (window.location.search.includes("code=") || window.location.search.includes("token=")) {
        setNovaAccountVerified(false);
        window.location.href = "/";
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [isPaymentOpen]);

  // login success message
  const handleLoginSuccess = () => {
    setIsLoginOpen(false);
    setNovaAccountVerified(false);
  };

  // created account message
  const handleAccountCreated = (newAccountId: string) => {
    setIsCreateOpen(false);
    setWelcomeMessage(`Account ${newAccountId} created! You can now use NOVA.`);
    
    // Trigger auto-sign-in after account creation (email/custodial only)
    setTimeout(() => {
      autoSignInWithNovaAccount(newAccountId, userData?.email);
      setWelcomeMessage('');
    }, 1500);
  };

  // handle payment (from payment modal)
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
      
      await createAccount(pendingId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Funding error: ${errMsg}`);
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
          email: userData?.email,
          wallet_id: userData?.wallet_id,
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Creation failed');
      }

      const { accountId } = await res.json();
      
      handleAccountCreated(accountId);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Creation error: ${errMsg}`);
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
      <Header 
        onOpenLogin={() => setIsLoginOpen(true)} 
        onOpenPayment={() => {
          setPendingId(accountId || '');
          setIsPaymentOpen(true);
        }}
      /> 
      {welcomeMessage && (
        <div className="p-4 text-center text-green-400 bg-green-500/20 border-b border-green-400/30">
          {welcomeMessage}
        </div>
      )}
      {(error || walletError) && (
        <div className="p-4 text-center text-red-400 bg-red-500/20 border-b border-red-400/30">
          {error || walletError} {' '}
          <Button variant="ghost" size="sm" onClick={() => setError('')}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading indicator while verifying NOVA account */}
      {isSignedIn && !novaAccountVerified && (
        <div className="p-2 text-center text-purple-300 bg-purple-500/10 border-b border-purple-400/20 text-sm">
          <span className="animate-pulse">Connecting NOVA account...</span>
        </div>
      )}

      <main className="flex-1 flex items-center justify-center p-4 lg:p-8">
        <div className="page-container w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-center">
          {/* Hero */}
          <section className="hero-section flex-1 text-center lg:text-left mb-8 lg:mb-0 lg:pr-8 max-w-md lg:max-w-lg">
            <div className="flex justify-center lg:justify-start mb-6 lg:mb-8">
              <img
                src="/logo-dark.svg"
                alt="NOVA - Secure File Sharing"
                className="w-56 h-56 md:w-64 md:h-64 lg:w-80 lg:h-80 object-contain drop-shadow-2xl hover:drop-shadow-[0_0_40px_rgba(168,85,247,0.5)] transition-all duration-300 hover:scale-105"
              />
            </div>
            <h2 className="font-museo text-4xl md:text-5xl lg:text-6xl font-black text-white mb-6 leading-[1.1] tracking-tight animate-slide-up">
              Secure data layer for{' '}
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400 bg-clip-text text-transparent">
                Multi-Agent Systems
              </span>
            </h2>
            <p className="font-space text-lg md:text-xl lg:text-2xl text-purple-200 mb-8 leading-relaxed font-medium">
              NOVA is a self-sovereign data storage for AI agents — decryptable by authorized parties only, and fully auditable: every data access can be verified on-chain.
            </p>

            {/* Feature Pills */}
            <div className="flex flex-wrap justify-center lg:justify-start gap-3 mb-6 animate-slide-up animation-delay-200">
              <div className="px-4 py-2 bg-purple-500/20 border border-purple-400/30 rounded-full text-purple-200 text-sm font-medium">
                🔐 Encrypted
              </div>
              <div className="px-4 py-2 bg-purple-500/20 border border-purple-400/30 rounded-full text-purple-200 text-sm font-medium">
                🔍 Auditable
              </div>
              <div className="px-4 py-2 bg-purple-500/20 border border-purple-400/30 rounded-full text-purple-200 text-sm font-medium">
                🪪 Self-Sovereign
              </div>
            </div>
          </section>

          {/* Chat Section */}
          <section className="chat-container flex-1 relative w-full max-w-2xl lg:max-w-3xl h-[500px] md:h-[550px] lg:h-[600px] rounded-lg overflow-hidden shadow-lg">
            {isConnected ? (
              /* Show ChatInterface when connected */
              <ChatInterface 
                accountId={accountId!} 
                email={user?.email || ''} 
              />
            ) : (
              /* Blur overlay when not connected */
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#280449]/80 backdrop-blur-sm rounded-lg border border-purple-600/50">
                <MessageSquare size={64} className="text-gray-400 mb-4 animate-pulse" />
                <p className="text-purple-200 mb-4 text-center px-4">
                  Connect to unlock secure file-sharing
                </p>
                <Button 
                  onClick={handleConnect} 
                  className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded"
                >
                  Get Started
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="footer w-full bg-[#280449]/90 border-t border-purple-900/50 p-4 text-center text-sm">
        <div className="flex justify-center space-x-6">
          <a href="https://civictech-ou.gitbook.io/nova-docs/" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            Documentation
          </a>
          <a href="https://github.com/jcarbonnell/nova" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            GitHub
          </a>
          <a href="https://x.com/nova_sdk" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            X
          </a>
          <a href="https://t.me/nova_sdk" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 transition-colors text-purple-200">
            Contact
          </a>
        </div>
        <p className="mt-2 text-purple-300">&copy; 2026 CivicTech OÜ. All rights reserved.</p>
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