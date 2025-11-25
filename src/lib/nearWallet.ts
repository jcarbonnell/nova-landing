// src/lib/nearWallet.ts
import { KeyPair, type KeyPairString } from "@near-js/crypto";

export async function connectWithPrivateKey(privateKey: string, accountId: string) {
  const networkId = process.env.NEXT_PUBLIC_NETWORK_ID || "testnet";

  const keyPair = KeyPair.fromString(privateKey as KeyPairString);

  const keyStoreKey = `near-api-js:keystore:${accountId}:${networkId}`;
  localStorage.setItem(keyStoreKey, keyPair.toString());

  // Also set the wallet selector ID
  localStorage.setItem(":wallet-selector:selectedWalletId", "my-near-wallet");
  
  // Store the account list that wallet selector checks
  localStorage.setItem(
    ":wallet-selector:my-near-wallet:accounts", 
    JSON.stringify([{
      accountId, 
      publicKey: keyPair.getPublicKey().toString(),
    }])
  );
}