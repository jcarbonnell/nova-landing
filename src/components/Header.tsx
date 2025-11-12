// src/components/Header.tsx
'use client';
import { useUser } from '@auth0/nextjs-auth0/client';
import { useWalletState, useWalletSelectorModal } from '@/providers/WalletProvider';
import { Button } from './ui/button';
import { LogIn, User, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Header() {
  const { user, isLoading: authLoading } = useUser();
  const { isSignedIn, accountId, loading: walletLoading } = useWalletState();
  const { modal } = useWalletSelectorModal();  // Top-level hook call
  const router = useRouter();

  const isConnected = user && isSignedIn;
  const loading = authLoading || walletLoading;

  const handleConnect = () => {
  if (!user) {
    router.push('/api/auth/login');  // Auth0 redirect
  } else if (!isSignedIn) {
    if (modal) {
      modal.show();
    } else {
      console.warn('Wallet modal not ready—retrying init');  // Fallback log; provider should handle
    }
  }
};

  return (
    <header className="bg-white shadow-sm border-b px-4 md:px-6 py-4 flex justify-between items-center sticky top-0 z-50">
      <div className="flex items-center space-x-2">
        <h1 className="text-2xl font-bold text-blue-600">NOVA</h1>
        <p className="text-sm text-gray-600 hidden sm:block">Your data. Your vault. Your rules.</p>
      </div>
      <div className="flex items-center space-x-4">
        {loading ? (
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
            <span className="text-sm text-gray-500">Loading...</span>
          </div>
        ) : isConnected ? (
          <div className="flex items-center space-x-2">
            <User size={18} />
            <span className="text-sm max-w-32 truncate">{user?.email || accountId}</span>
            <Link href="/api/auth/logout" className="text-blue-600 hover:underline text-sm">
              Logout
            </Link>
          </div>
        ) : (
          <Button onClick={handleConnect} variant="default" size="default" className="flex items-center space-x-2">
            {isSignedIn ? <LogIn size={18} /> : <Wallet size={18} />}
            <span>{!user ? 'Sign Up' : 'Connect Wallet'}</span>
          </Button>
        )}
      </div>
    </header>
  );
}