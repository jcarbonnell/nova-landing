// src/components/Header.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useWalletState, useWalletSelectorModal } from '@/providers/WalletProvider';
import { Button } from './ui/button';
import { LogIn, User, Wallet } from 'lucide-react';

interface HeaderProps {
  onOpenLogin?: () => void;
  onOpenPayment?: () => void;
  /** Wallet SIWN state, passed from HomeClient (the provider can't tell
   *  "wallet connected" from "wallet signed in to NOVA"). */
  hasWalletSession?: boolean;
  /** True when the connected user is a wallet user (no Auth0 email). */
  isWalletUser?: boolean;
  /** Triggers NEP-413 sign-in; same handler the connect-panel button uses.
   *  Must run in a click gesture (web-popup wallets need it — see HomeClient). */
  onSignInWallet?: () => void;
}

export default function Header({
  onOpenLogin,
  onOpenPayment,
  hasWalletSession,
  isWalletUser,
  onSignInWallet,
}: HeaderProps) {  
  const { user, isLoading: authLoading } = useUser();
  const { isSignedIn, accountId, loading: walletLoading } = useWalletState();
  const { modal } = useWalletSelectorModal();

  const isConnected = isSignedIn && !!accountId;
  const loading = authLoading || walletLoading;

  const handleConnect = () => {
    if (!user) {
      if (onOpenLogin) {
        onOpenLogin();
      } else {
        window.location.assign('/auth/login');
      }
    } else if (!isSignedIn) {
      if (modal) {
        modal.show();
      } else {
        console.warn('Wallet modal not ready');
      }
    }
  };

  const handleLogout = async () => {
    try {
      // Clear any client-side state first
      sessionStorage.clear();
      localStorage.clear();
      
      // Navigate to logout endpoint which will clear server session
      // Using window.location to force full page reload
      window.location.href = '/auth/logout';
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback: force reload anyway
      window.location.href = '/';
    }
  };

  // Detect network
  const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK === 'testnnet';
  const networkUrl = isTestnet ? 'https://nova-sdk.com' : 'https://testnet.nova-sdk.com';

  return (
    <header className="bg-[#280449]/90 shadow-sm border-b border-purple-900/50 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-50 backdrop-blur-sm">
      {/* Network Indicator */}
      <div className="flex items-center">
        <a
        href={networkUrl}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            isTestnet
              ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/50'
              : 'bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/50'
          }`}
          title={`Switch to ${isTestnet ? 'Mainnet' : 'Testnet'}`}
        >
          <span className={`w-2 h-2 rounded-full ${isTestnet ? 'bg-purple-400' : 'bg-green-400'}`} />
          {isTestnet ? 'Testnet' : 'Mainnet'}
        </a>
      </div>
      <div className="flex items-center space-x-4 flex-1 justify-end">
        {loading ? (
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-300" />
            <span className="text-sm text-purple-200">Loading...</span>
          </div>
        ) : isConnected ? (
          <div className="flex items-center space-x-2">
            {isWalletUser && !hasWalletSession ? (
              // Wallet connected but not yet SIWN'd: the sign-in gesture lives
              // HERE (renders at every breakpoint, unlike the desktop-only
              // connect panel). Clicking calls the same NEP-413 handler.
              <Button
                variant="default"
                size="sm"
                onClick={onSignInWallet}
                className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Wallet size={16} />
                <span>Sign in with wallet</span>
              </Button>
            ) : (
              // Email users, and wallet users who HAVE signed in: full account UI.
              <div
                onClick={onOpenPayment}
                className="flex items-center space-x-2 px-3 py-2 rounded-md bg-purple-900/50 border border-purple-500/30 cursor-pointer hover:bg-purple-800/50"
              >
                <Wallet size={16} className="text-purple-300" />
                <span className="text-sm max-w-32 truncate text-purple-100">
                  Manage Account
                </span>
              </div>
            )}
            <Button 
              variant="default"
              size="sm"
              onClick={handleLogout}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Logout
            </Button>
          </div>
        ) : (
          <Button onClick={handleConnect} variant="default" size="default" className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white transition-all hover:scale-105">
            {isSignedIn ? <LogIn size={18} /> : <Wallet size={18} />}
            <span>Login</span>
          </Button>
        )}
      </div>
    </header>
  );
}