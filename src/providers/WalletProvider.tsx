// nova-landing/src/providers/WalletProvider.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { WalletSelector } from '@near-wallet-selector/core';

interface ModalApi {
  show: () => void;
  hide: () => void;
}

interface WalletContextType {
  selector?: WalletSelector;
  modal?: ModalApi;
  isSignedIn: boolean;
  accountId?: string;
  loading: boolean;
  error?: string;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletContextType>({ isSignedIn: false, loading: true });

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        setWallet(prev => ({ ...prev, loading: true, error: undefined }));

        const { setupWalletSelector } = await import('@near-wallet-selector/core');
        const { setupModal } = await import('@near-wallet-selector/modal-ui');
        const { setupMyNearWallet } = await import('@near-wallet-selector/my-near-wallet');
        // Add more wallets if you want: setupHereWallet(), setupMeteorWallet(), etc.

        const selector = await setupWalletSelector({
          network: process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet',
          modules: [setupMyNearWallet()],
        });

        // This is the correct v10+ way – no container option needed
        const modal = setupModal(selector, {
          // No container, no theme – just let it mount to body
        });

        const state = selector.store.getState();
        const accounts = state.accounts || [];
        const isSignedIn = accounts.length > 0;
        const accountId = accounts[0]?.accountId;

        if (mounted) {
          setWallet({
            selector,
            modal,
            isSignedIn,
            accountId,
            loading: false,
          });
        }

        // Subscribe to account changes
        selector.subscribeOnAccountChange((newAccountId) => {
          if (mounted) {
            setWallet(prev => ({
              ...prev,
              isSignedIn: !!newAccountId,
              accountId: newAccountId || undefined,
            }));
          }
        });
      } catch (err) {
        console.error('Wallet selector init failed:', err);
        if (mounted) {
          setWallet(prev => ({ ...prev, loading: false, error: 'Wallet init failed' }));
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWalletSelector() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWalletSelector must be within WalletProvider');
  return context.selector;
}

export function useWalletSelectorModal() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWalletSelectorModal must be within WalletProvider');
  return { modal: context.modal };
}

export function useWalletState() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWalletState must be within WalletProvider');
  return {
    isSignedIn: context.isSignedIn,
    accountId: context.accountId,
    loading: context.loading,
    error: context.error,
  };
}