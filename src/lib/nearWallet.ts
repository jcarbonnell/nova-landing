// src/lib/nearWallet.ts
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { BrowserLocalStorageKeyStore } from "@near-js/keystores-browser";
import type { WalletSelector } from "@near-wallet-selector/core";

export async function connectWithPrivateKey(
  privateKey: string,
  accountId: string,
  selector?: WalletSelector
) {
  const networkId = process.env.NEXT_PUBLIC_NETWORK_ID || "testnet";

  // Type-safe cast — this is the official way in the NEAR ecosystem
  const keyPair = KeyPair.fromString(privateKey as KeyPairString);

  const keyStore = new BrowserLocalStorageKeyStore();
  await keyStore.setKey(networkId, accountId, keyPair);

  // Fake wallet selection (required for wallet-selector to think we're signed in)
  localStorage.setItem(":wallet-selector:selectedWalletId", "my-near-wallet");

  // Force selector to reload accounts from localStorage
  if (selector) {
    try {
      const state = selector.store.getState();
      console.log("🔄 Current wallet state:", state);
      
      // Get the my-near-wallet instance
      const wallet = await selector.wallet("my-near-wallet");
      
      if (wallet) {
        console.log("🔄 Triggering wallet selector state update...");
        
        // This simulates the wallet connection flow
        const accounts = await wallet.getAccounts();
        console.log("📋 Wallet accounts:", accounts);
        
        // If accounts are found, the subscription should fire automatically
        if (accounts.length > 0) {
          console.log("✅ Wallet selector state updated:", accounts[0].accountId);
        }
      }
    } catch (err) {
      console.warn("⚠️ Could not update selector state:", err);
      
      // Fallback: Manual state injection
      interface SelectorStore {
        setState?: (state: { 
          selectedWalletId: string; 
          accounts: { accountId: string }[] 
        }) => void;
      }
      
      const selectorStore = (window as unknown as { 
        __wallet_selector_store?: SelectorStore 
      }).__wallet_selector_store;
      
      if (selectorStore?.setState) {
        console.log("🔄 Using fallback state injection...");
        selectorStore.setState({
          selectedWalletId: "my-near-wallet",
          accounts: [{ accountId }],
        });
      }
    }
  }
}