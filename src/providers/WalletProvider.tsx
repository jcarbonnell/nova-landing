// src/providers/WalletProvider.tsx
'use client';
import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { WalletSelector } from '@near-wallet-selector/core';
import "@near-wallet-selector/modal-ui/styles.css";

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
  refreshWalletState: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletContextType>({ 
    isSignedIn: false, 
    loading: true,
    refreshWalletState: async () => {},
  });

  //Expose global function to force wallet state
  useEffect(() => {
    (window as any).__forceWalletConnect = (accountId: string) => {
      setWallet(prev => ({
        ...prev,
        isSignedIn: true,
        accountId,
      }));
    };
    
    return () => {
      delete (window as any).__forceWalletConnect;
    };
  }, []);

  // manually refresh wallet state
  const [selectorRef, setSelectorRef] = useState<WalletSelector | null>(null);

  const refreshWalletState = useCallback(async () => {
    if (!selectorRef) {
      console.warn('⚠️ No selector available to refresh');
      return;
    }

    try {
      const state = selectorRef.store.getState();
      const accounts = state.accounts || [];
      const isSignedIn = accounts.length > 0;
      const accountId = accounts[0]?.accountId;

      setWallet(prev => ({
        ...prev,
        isSignedIn,
        accountId,
      }));
    } catch (err) {
      console.error('❌ Refresh wallet state error:', err);
    }
  }, [selectorRef]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function init() {
      try {
        setWallet(prev => ({ ...prev, loading: true, error: undefined }));

        const { setupWalletSelector } = await import('@near-wallet-selector/core');
        const { setupModal } = await import('@near-wallet-selector/modal-ui');
        const { setupMyNearWallet } = await import('@near-wallet-selector/my-near-wallet');
        // Add more wallets if you want: setupHereWallet(), setupMeteorWallet(), etc.

        const selector = await setupWalletSelector({
          network: {
            networkId: 'testnet',
            nodeUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            indexerUrl: "https://api.testnet.nearblocks.io/v1",
          },
          modules: [setupMyNearWallet()],
        });

        const modal = setupModal(selector, {
          contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "nova-sdk-5.testnet",
        });

        const state = selector.store.getState();
        const accounts = state.accounts || [];
        const isSignedIn = accounts.length > 0;
        const accountId = accounts[0]?.accountId;

        // Function to refresh wallet state
        const refresh = async () => {
          try {
            const currentState = selector.store.getState();
            const currentAccounts = currentState.accounts || [];
            const currentIsSignedIn = currentAccounts.length > 0;
            const currentAccountId = currentAccounts[0]?.accountId;

            if (mounted) {
              setWallet(prev => ({
                ...prev,
                isSignedIn: currentIsSignedIn,
                accountId: currentAccountId,
              }));
            }
          } catch (err) {
            console.error('❌ Refresh error:', err);
          }
        };

        if (mounted) {
          setSelectorRef(selector);
          setWallet({
            selector,
            modal,
            isSignedIn,
            accountId,
            loading: false,
            refreshWalletState: refresh,
          });
        }

        // Subscribe to account changes
        const subscription = selector.store.observable.subscribe((state) => {
          
          const accounts = state.accounts || [];
          const isSignedIn = accounts.length > 0;
          const accountId = accounts[0]?.accountId;
          
          if (mounted) {
            setWallet(prev => ({
              ...prev,
              isSignedIn,
              accountId,
            }));
          }
        });

        unsubscribe = () => subscription.unsubscribe();

        return () => {
          if (unsubscribe) unsubscribe();
        };

      } catch (err) {
        console.error('Wallet selector init failed:', err);
        if (mounted) {
          setWallet(prev => ({ ...prev, loading: false, error: 'Wallet init failed' }));
        }
      }
    }

    const cleanup = init();

    return () => {
      mounted = false;
      cleanup?.then(cleanupFn => cleanupFn?.());
    };
  }, []);

  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWalletSelector() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWalletSelector must be within WalletProvider');
  return context.selector!;
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
    refreshWalletState: context.refreshWalletState,
  };
}