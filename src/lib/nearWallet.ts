// src/lib/nearWallet.ts
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { BrowserLocalStorageKeyStore } from "@near-js/keystores-browser";

export async function connectWithPrivateKey(
  privateKey: string,
  accountId: string,
) {
  const networkId = process.env.NEXT_PUBLIC_NETWORK_ID || "testnet";

  const keyPair = KeyPair.fromString(privateKey as KeyPairString);
  const keyStore = new BrowserLocalStorageKeyStore();
  await keyStore.setKey(networkId, accountId, keyPair);

  localStorage.setItem(":wallet-selector:selectedWalletId", "my-near-wallet");
  
  console.log("✅ Key injected into localStorage for:", accountId);
}