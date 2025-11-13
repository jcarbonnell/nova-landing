// nova-landing/src/providers/WalletProvider.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { WalletSelector, Account } from '@near-wallet-selector/core';

// Minimal type for modal-ui return (methods only; per docs)
interface ModalApi {
  show: () => void;
  hide: () => void;
  // Add more if needed (e.g., isVisible: boolean)
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

        const selector = await setupWalletSelector({
          network: 'testnet',  // Swap to 'mainnet' via env in prod
          modules: [setupMyNearWallet()],
        }) as WalletSelector;  // Typed cast

        const modal = setupModal(selector, {});

        // Initial accounts from store state
        const state = selector.store.getState();
        const accounts: Account[] = state.accounts;
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

          // Subscribe to account changes (void return; no explicit unsubscribe per docs)
          // Cleanup handled by effect unmount; re-init on remount if needed
          selector.subscribeOnAccountChange(async (accountId: string | null) => { // Typed Account | null
            if (mounted) {
              const newIsSignedIn = !!accountId;
              const newAccountId = accountId || undefined;
              setWallet(prev => ({
                ...prev,
                isSignedIn: newIsSignedIn,
                accountId: newAccountId,
                error: newIsSignedIn ? undefined : prev.error,
              }));
            }
          });
        }
      } catch (error) {
        console.error('Wallet init error:', error);
        if (mounted) {
          setWallet(prev => ({ ...prev, loading: false, error: 'Wallet setup failed' }));
        }
      }
    }

    init();

    return () => {
      mounted = false;
      // No explicit unsubscribe; selector subscriptions are lightweight and GC'd on unmount
    };
  }, []);

  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
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