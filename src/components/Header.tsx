// src/components/Header.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useWalletState, useWalletSelectorModal } from '@/providers/WalletProvider';
import { Button } from './ui/button';
import { LogIn, User, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface HeaderProps {
  onOpenLogin?: () => void;
}

export default function Header({ onOpenLogin }: HeaderProps) {  
  const { user, isLoading: authLoading } = useUser();
  const { isSignedIn, accountId, loading: walletLoading } = useWalletState();
  const { modal } = useWalletSelectorModal();
  const router = useRouter();

  const isConnected = isSignedIn && !!accountId;
  const loading = authLoading || walletLoading;

  const handleConnect = () => {
    if (!user) {
      if (onOpenLogin) {
        onOpenLogin();  // New: Open modal if prop available (preferred flow)
      } else {
        // Fallback: Direct Auth0 redirect (for non-modal contexts)
        router.push('/api/auth/login');
      }
    } else if (!isSignedIn) {
      if (modal) {
        modal.show();
      } else {
        console.warn('Wallet modal not ready');
      }
    }
  };

  const handleLogout = () => {
    const returnTo = encodeURIComponent(window.location.origin);
    window.location.href = `/api/auth/logout?returnTo=${returnTo}`;
  };

  return (
    <header className="bg-[#280449]/90 shadow-sm border-b border-purple-900/50 px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-50 backdrop-blur-sm">
      <div className="flex items-center space-x-4 flex-1 justify-end">
        {loading ? (
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-300" />
            <span className="text-sm text-purple-200">Loading...</span>
          </div>
        ) : isConnected ? (
          <div className="flex items-center space-x-2">
            <User size={18} className="text-purple-300" />
            <span className="text-sm max-w-32 truncate text-purple-200">
              {user?.email || accountId}
            </span>
            <button 
              onClick={() => router.push('/auth/logout?returnTo=%2F')}
              className="text-purple-300 hover:text-white text-sm underline-offset-2"
            >
              Logout
            </button>
          </div>
        ) : (
          <Button onClick={handleConnect} variant="default" size="default" className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white">
            {isSignedIn ? <LogIn size={18} /> : <Wallet size={18} />}
            <span>{!user ? 'Sign Up' : 'Login'}</span>
          </Button>
        )}
      </div>
    </header>
  );
}