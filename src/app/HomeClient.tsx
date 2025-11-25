// src/app/homeclient.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { useWalletState, useWalletSelector, useWalletSelectorModal } from '@/providers/WalletProvider';
import type { User } from '@/lib/auth0';
import { connectWithPrivateKey } from '@/lib/nearWallet';
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
  const { isSignedIn, accountId, loading: walletLoading, refreshWalletState } = useWalletState();
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
  const [hasCheckedAccount, setHasCheckedAccount] = useState(false);
  const [sessionTokenVerified, setSessionTokenVerified] = useState(false);
  const autoSignInAttemptedRef = useRef(false);

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

  // CRITICAL: Verify session token before checking account
  const verifySessionToken = useCallback(async () => {
    if (!user?.email || sessionTokenVerified) return true;

    console.log('Verifying Auth0 session token...');
    
    try {
      const response = await fetch('/auth/profile');
      
      if (response.ok) {
        const profile = await response.json();
        setSessionTokenVerified(true);
        return true;
      } else {
        console.warn('⚠️ Session verification failed, status:', response.status);
        
        // If unauthorized, may need to re-login
        if (response.status === 401) {
          console.log('Session expired, redirecting to login...');
          setIsLoginOpen(true);
          return false;
        }
        
        return false;
      }
    } catch (err) {
      console.error('❌ Session verification error:', err);
      return false;
    }
  }, [user?.email, sessionTokenVerified]);

  const checkExistingAccount = useCallback(async () => {
    if (!user?.email) {
      console.log('No user email, cannot check account');
      return;
    }
    
    if (hasCheckedAccount) {
      console.log('Account already checked, skipping...');
      return;
    }

    // CRITICAL: Verify session before checking account
    const tokenValid = await verifySessionToken();
    if (!tokenValid) {
      console.warn('⚠️ Session token invalid, cannot proceed with account check');
      setError('Session expired. Please log in again.');
      return;
    }

    setError('');
    setHasCheckedAccount(true);

    console.log('Checking for existing account');

    try {
      const res = await fetch('/api/auth/check-for-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Check failed');
      }

      const { exists, accountId: existingId, accountCheck, warning } = await res.json();

      if (warning) {
        console.warn('⚠️ Account check warning:', warning);
        // Continue anyway - warning is informational
      }

      if (!accountCheck) {
        console.error('❌ Account check failed to complete');
        setError('Account verification failed. Please try again.');
        setHasCheckedAccount(false); // Allow retry
        return;
      }

      if (exists && existingId) {
        setWelcomeMessage(`Welcome back! Account ${existingId} ready.`);
        // Don't call autoSignInFromShade here - let the useEffect handle it
        // based on the hasCheckedAccount and sessionTokenVerified flags
      } else {
        console.log('No existing account, opening creation modal...');
        setUserData({ email: user.email });
        setIsCreateOpen(true);
      }
    } catch (err) {
      console.error('❌ Check existing account error:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Account check failed: ${errMsg}`);
      setHasCheckedAccount(false); // Allow retry on error
    }
  }, [user?.email, hasCheckedAccount, verifySessionToken]);

  // AUTO-SIGN-IN FROM SHADE TEE after account creation
  const selector = useWalletSelector();

  const autoSignInFromShade = useCallback(async () => {
  if (!user?.email || isSignedIn || !selector) {
    return;
  }

  console.log('Attempting auto-sign-in from Shade TEE...');

  try {
    const checkRes = await fetch('/api/auth/check-for-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });

    if (!checkRes.ok) {
      console.warn('⚠️ Account check failed during auto-sign-in');
      return;
    }
    
    const { exists, accountId: existingAccountId } = await checkRes.json();
    if (!exists || !existingAccountId) {
      console.log('No account in Shade, cannot auto-sign-in');
      return;
    }

    console.log('Account found in Shade');

    const keyRes = await fetch('/api/auth/retrieve-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });

    if (!keyRes.ok) {
      console.warn('⚠️ Failed to retrieve key from Shade');
      return;
    }
    
    const { private_key } = await keyRes.json();
    if (!private_key) {
      console.warn('⚠️ No private key returned from Shade');
      return;
    }

    console.log('Auto-login successful');

    // Inject key into localStorage
    await connectWithPrivateKey(private_key, existingAccountId);

    console.log('Key injected, forcing state via global function...');

    // Force state update
    (window as any).__forceWalletConnect?.(existingAccountId);

    const displayName = existingAccountId.split('.')[0];
    setWelcomeMessage(`Signed in as ${displayName}!`);
    setTimeout(() => setWelcomeMessage(''), 6000);

  } catch (err) {
    console.error('❌ Auto sign-in failed:', err);
    if (err instanceof Error) {
      console.error('Error details:', err.message);
    }
  }
}, [user?.email, isSignedIn, selector]);

  useEffect(() => {
    if (!user || loading) {
      console.log('Waiting for user/wallet load...');
      return;
    }

    if (isSignedIn) {
      console.log('Already signed in');
      return;
    }

    // Not signed in - check if we need to do account check or auto-sign-in
    if (!sessionTokenVerified) {
      // Step 1: Verify session first
      console.log('User logged in, verifying session...');
      verifySessionToken();
    } else if (!hasCheckedAccount) {
      // Step 2: Then check for account
      console.log('Session verified, checking account...');
      checkExistingAccount();
    } else if (hasCheckedAccount && sessionTokenVerified && !autoSignInAttemptedRef.current) {
      // Step 3: Only attempt ONCE using ref
      console.log('Account exists, attempting auto-sign-in...');
      autoSignInAttemptedRef.current = true;
      autoSignInFromShade();
    }
  }, [user, loading, isSignedIn, sessionTokenVerified, hasCheckedAccount, accountId, verifySessionToken, checkExistingAccount, autoSignInFromShade]);

  // logout message
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('loggedOut') === '1') {
      setWelcomeMessage('Successfully logged out.');
      // reset on logout
      setHasCheckedAccount(false);
      setSessionTokenVerified(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // reload client-side after server-side redirect
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const isCallback = params.has("code") || params.has("state") || params.has("token") || params.has("near");
    
    if (isCallback) {
      console.log('OAuth callback detected, cleaning URL and resetting state...');
      window.history.replaceState({}, "", "/");
      // reset check flags after callback
      setHasCheckedAccount(false);
      setSessionTokenVerified(false);
      window.location.href = "/";
    }
  }, []);

  // in case the above runs too early, a fallback timeout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = setTimeout(() => {
      if (window.location.search.includes("code=") || window.location.search.includes("token=")) {
        console.log('Fallback: Cleaning OAuth params...');
        setHasCheckedAccount(false);
        setSessionTokenVerified(false);
        window.location.href = "/";
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // handleLoginSuccess (from modal callback)
  const handleLoginSuccess = () => {
    console.log('Login success, closing modal...');
    setIsLoginOpen(false);
    // After login, reset flags to trigger account check
    setHasCheckedAccount(false);
    setSessionTokenVerified(false);
  };

  // handleAccountCreated (from create modal)
  const handleAccountCreated = (newAccountId: string) => {
    console.log('Account created');
    setIsCreateOpen(false);
    setWelcomeMessage(`Account ${newAccountId} created! You can now use NOVA.`);
    
    // Trigger auto-sign-in after account creation
    setTimeout(() => {
      console.log('Triggering auto-sign-in after account creation...');
      autoSignInFromShade();
      setWelcomeMessage('');
    }, 3000);
  };

  // handlePayment (from payment modal)
  const handlePayment = async (sessionId: string, amount: string) => {
    console.log('Processing payment');
    
    try {
      const res = await fetch('/api/auth/fund-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, amount, accountId: pendingId }),
      });
      
      if (!res.ok) throw new Error('Funding failed');

      const { fundedAmountNear, txHash } = await res.json();
      console.log('Funding successful');
      
      setWelcomeMessage(`Funded ${fundedAmountNear} NEAR (tx: ${txHash})!`);
      setIsPaymentOpen(false);
      
      // Proceed to create
      await createAccount(pendingId);
    } catch (err) {
      console.error('❌ Payment error:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Funding error: ${errMsg}`);
    }
  };

  // skip payments
  const handleSkipPayment = () => {
    console.log('Skipping payment...');
    setIsPaymentOpen(false);
    createAccount(pendingId);
  };

  // createAccount (calls API)
  const createAccount = async (fullId: string) => {
    console.log('Creating account');
    
    try {
      const res = await fetch('/api/auth/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: fullId.split('.')[0], 
          email: userData?.email 
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Creation failed');
      }

      const { accountId } = await res.json();
      console.log('Account created successfully');
      
      handleAccountCreated(accountId);

    } catch (err) {
      console.error('❌ Account creation error:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Creation error: ${errMsg}`);
    }
  };

  const handleConnect = () => {
    console.log('Connect button clicked');
    
    if (!user) {
      console.log('No user, opening login modal...');
      setIsLoginOpen(true);
    } else if (!isSignedIn) {
      console.log('User exists but not signed in, opening wallet modal...');
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