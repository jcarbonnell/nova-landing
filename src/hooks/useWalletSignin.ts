// nova-landing/src/hooks/useWalletSignin.ts
//
// Item 2b — client-side wallet SIWN (§5.11-A).
//
// Drives the three-step self-custody flow using the wallet the user already
// connected via WalletProvider's selector:
//
//   1. POST /api/auth/wallet-nonce         → Shade-issued 32-byte nonce (hex)
//   2. wallet.signMessage({ message, recipient: 'nova-sdk.com', nonce })
//                                          → NEP-413 SignedMessage (signed client-side;
//                                             NOVA never sees the private key)
//   3. POST /api/auth/wallet-verify        → Shade verifies → mints nova_session
//
// On success the nova_session token is returned (and stored — see storeSession).
// This is the wallet analogue of the API-key/email session-token flow; the
// resulting token carries sub = wallet|<account_id> and is accepted by MCP
// exactly like every other nova_session.
//
// SELF-CUSTODY: the wallet signs; there is NO private-key retrieval for wallet
// users. This is what makes the challenge non-circular (§5.11).
//
// The `| void` return from signMessage is the REDIRECT case (e.g. MyNearWallet
// navigates away instead of resolving). We detect it and surface a clear error
// rather than hanging — inline wallets (Meteor, HERE, Nightly) resolve to a
// SignedMessage and complete in one call.

import { useState, useCallback } from 'react';
import { Buffer } from 'buffer'; // explicit import — do NOT rely on a global Buffer polyfill in the browser bundle
import type { WalletSelector } from '@near-wallet-selector/core';

// NOVA's NEP-413 recipient — MUST match Shade's WALLET_SIWN_RECIPIENT.
const RECIPIENT = 'nova-sdk.com';

// The human-readable message the wallet displays in its signing prompt.
// Not security-bearing (recipient + nonce bind the signature); keep it clear.
const SIGN_IN_MESSAGE = 'Sign in to NOVA';

export interface WalletSigninResult {
  token: string;
  account_id: string;
  expires_in: string;
}

export interface UseWalletSignin {
  signIn: () => Promise<WalletSigninResult | null>;
  loading: boolean;
  error: string | null;
}

/**
 * @param selector  the WalletSelector from useWalletSelector() (WalletProvider).
 * @param onSession  optional callback with the minted session (e.g. to store it
 *                   or flip app state). Also stored via storeSession() below.
 */
export function useWalletSignin(
  selector: WalletSelector | undefined,
  onSession?: (result: WalletSigninResult) => void,
): UseWalletSignin {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (): Promise<WalletSigninResult | null> => {
    setError(null);

    if (!selector) {
      setError('Wallet not ready. Try again in a moment.');
      return null;
    }

    setLoading(true);
    try {
      // Must have a connected wallet.
      const state = selector.store.getState();
      const accountId = state.accounts?.[0]?.accountId;
      if (!accountId) {
        setError('Connect a wallet first.');
        return null;
      }

      const wallet = await selector.wallet();

      // TEMP DIAGNOSTIC (remove after wiring confirmed): which wallet, and does
      // it expose signMessage? Answers "is signIn reached + does the wallet
      // support NEP-413" in one line.
      console.log('[SIWN] wallet resolved:', {
        id: (wallet as { id?: string }).id,
        hasSignMessage: typeof wallet.signMessage === 'function',
      });

      // Guard: the wallet must implement NEP-413 signMessage.
      if (typeof wallet.signMessage !== 'function') {
        setError('This wallet does not support message signing. Try Meteor, HERE, or Nightly.');
        return null;
      }

      // ── Step 1: server-issued nonce ─────────────────────────────────────────
      const nonceRes = await fetch('/api/auth/wallet-nonce', { method: 'POST' });
      if (!nonceRes.ok) {
        setError('Could not start sign-in. Please try again.');
        return null;
      }
      const { nonce } = (await nonceRes.json()) as { nonce?: string };
      if (!nonce) {
        setError('Could not start sign-in. Please try again.');
        return null;
      }

      // ── Step 2: wallet signs (client-side; self-custody) ────────────────────
      const signed = await wallet.signMessage({
        message: SIGN_IN_MESSAGE,
        recipient: RECIPIENT,
        nonce: Buffer.from(nonce, 'hex'), // 32 bytes; SignMessageParams.nonce is a Buffer
      });

      // `void` = redirect wallet (navigated away). We can't complete inline.
      if (!signed) {
        setError('This wallet uses a redirect flow that is not supported here. Use Meteor, HERE, or Nightly.');
        return null;
      }

      // ── Step 3: server verifies + mints nova_session ────────────────────────
      const verifyRes = await fetch('/api/auth/wallet-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signed_message: {
            accountId: signed.accountId,
            publicKey: signed.publicKey,
            signature: signed.signature,
            ...(signed.state ? { state: signed.state } : {}),
          },
          message: SIGN_IN_MESSAGE,
          nonce,
        }),
      });

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}));
        // Shade's codes: UNAUTHORIZED_NONCE_REPLAY (nonce), UNAUTHORIZED (sig/key).
        const msg =
          data.code === 'UNAUTHORIZED_NONCE_REPLAY'
            ? 'Sign-in expired. Please try again.'
            : data.error || 'Wallet verification failed.';
        setError(msg);
        return null;
      }

      const result = (await verifyRes.json()) as WalletSigninResult;

      storeSession(result);
      onSession?.(result);
      return result;
    } catch (e) {
      // User rejection in the wallet, network errors, etc.
      const message = e instanceof Error ? e.message : 'Sign-in failed.';
      // Wallet "user rejected" errors are common and not worth alarming copy.
      setError(/reject|denied|cancel/i.test(message) ? 'Sign-in cancelled.' : message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [selector, onSession]);

  return { signIn, loading, error };
}

/**
 * Persist the nova_session for the SDK/app to use on subsequent calls.
 *
 * NOTE ON STORAGE: sessionStorage keeps the token for the tab session and avoids
 * the long-lived-localStorage footgun. If your app already stores the
 * email/apikey nova_session somewhere specific (a cookie, a context), route this
 * to the SAME place instead — the wallet token is not special, it's the same
 * nova_session shape. Left as sessionStorage as a safe default; wire to your
 * existing session store during the §D1 rework if you centralise it.
 */
function storeSession(result: WalletSigninResult): void {
  try {
    sessionStorage.setItem('nova_session', result.token);
    sessionStorage.setItem('nova_account_id', result.account_id);
  } catch {
    // sessionStorage unavailable (SSR/blocked) — the caller still gets the token
    // via the return value and onSession callback.
  }
}