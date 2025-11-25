// src/lib/nearWallet.ts
import { KeyPair, type KeyPairString } from "@near-js/crypto";

export async function connectWithPrivateKey(
  privateKey: string,
  accountId: string,
) {
  const networkId = process.env.NEXT_PUBLIC_NETWORK_ID || "testnet";

  const keyPair = KeyPair.fromString(privateKey as KeyPairString);

  // Store key in the EXACT format my-near-wallet expects
  const keyStoreKey = `near-api-js:keystore:${accountId}:${networkId}`;
  localStorage.setItem(keyStoreKey, keyPair.toString());
  // Also set the wallet selector ID
  localStorage.setItem(":wallet-selector:selectedWalletId", "my-near-wallet");
  
  // Store the account list that wallet selector checks
  const pendingAccounts = JSON.stringify([{
    accountId,
    publicKey: keyPair.getPublicKey().toString(),
  }]);
  localStorage.setItem(":wallet-selector:my-near-wallet:accounts", pendingAccounts);
  
  console.log("✅ Key injected with correct format:", accountId);
}