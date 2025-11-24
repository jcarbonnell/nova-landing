// src/lib/nearWallet.ts
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { BrowserLocalStorageKeyStore } from "@near-js/keystores-browser";

export async function connectWithPrivateKey(
  privateKey: string,
  accountId: string
) {
  const networkId = process.env.NEXT_PUBLIC_NETWORK_ID || "testnet";

  // Type-safe cast — this is the official way in the NEAR ecosystem
  const keyPair = KeyPair.fromString(privateKey as KeyPairString);

  const keyStore = new BrowserLocalStorageKeyStore();
  await keyStore.setKey(networkId, accountId, keyPair);

  // Fake selected wallet (required for wallet-selector to think we're signed in)
  localStorage.setItem(":wallet-selector:selectedWalletId", "injected");

  // Optional: force selector store update — now fully typed
  interface SelectorStore {
    setState?: (state: { selectedWalletId: string; accounts: { accountId: string }[] }) => void;
  }

  const selectorStore = (window as unknown as { __wallet_selector_store?: SelectorStore })
    .__wallet_selector_store;

  if (selectorStore?.setState) {
    selectorStore.setState({
      selectedWalletId: "injected",
      accounts: [{ accountId }],
    });
  }
}