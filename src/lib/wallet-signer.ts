// nova-landing/src/lib/wallet-signer.ts
//
// Deliverable 2 (A): the self-custodial signer the NOVA SDK uses in wallet mode
// (NovaSdk config `walletSigner`). Every contract write is signed AND paid by
// the user's own wallet through wallet-selector v10; NOVA never holds this key.
//
// The SDK depends only on this shape (nova-sdk-js NovaWalletSigner). It is
// declared here structurally so this file does not need the unreleased SDK
// type; once the SDK is published, passing the result as `walletSigner`
// type-checks against the real interface.
//
// Refusals (all BEFORE any wallet prompt):
//   • custodial accounts (*.nova-sdk.near / *.nova-sdk-7.testnet): NOVA signs those;
//   • redirect ("browser") wallets: they leave the page mid-operation, so the
//     SDK's post-chain MCP step (key creation, rotation, the upload's bytes) is
//     lost. v1 supports popup/extension wallets only (roadmap deferral);
//   • a wallet that does not hold the session's account.

import { actionCreators } from '@near-js/transactions';
import type { WalletSelector } from '@near-wallet-selector/core';

export interface WalletFunctionCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: bigint;
  deposit: bigint;
}

export interface NovaWalletSignerLike {
  readonly accountId: string;
  signAndSendFunctionCall(call: WalletFunctionCall): Promise<{ txHash: string }>;
}

export class WalletSignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletSignerError';
  }
}

const CUSTODIAL_SUFFIXES = ['.nova-sdk.near', '.nova-sdk-7.testnet'];

export function isCustodialAccount(accountId: string): boolean {
  const a = accountId.trim().toLowerCase();
  return CUSTODIAL_SUFFIXES.some((s) => a.endsWith(s));
}

/** Extract the tx hash from a FinalExecutionOutcome; throw if it failed on chain. */
export function txHashFromOutcome(outcome: unknown): string {
  if (!outcome || typeof outcome !== 'object') {
    throw new WalletSignerError('Wallet returned no transaction outcome (redirect wallets are not supported)');
  }
  const o = outcome as {
    status?: unknown;
    transaction?: { hash?: unknown };
    transaction_outcome?: { id?: unknown };
  };
  const status = o.status;
  if (status === 'Failure' || (status && typeof status === 'object' && 'Failure' in status)) {
    const detail = typeof status === 'object' ? JSON.stringify((status as { Failure: unknown }).Failure) : '';
    throw new WalletSignerError(`Transaction failed on chain${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const hash = o.transaction_outcome?.id ?? o.transaction?.hash;
  if (typeof hash !== 'string' || !hash) {
    throw new WalletSignerError('Wallet outcome has no transaction hash');
  }
  return hash;
}

/**
 * Build the signer for the CURRENTLY connected wallet. Call it right before
 * constructing the SDK for a wallet session; it checks the wallet once here and
 * again on every call (the user may switch wallets in between).
 */
export async function createWalletSigner(
  selector: WalletSelector,
  accountId: string,
): Promise<NovaWalletSignerLike> {
  if (isCustodialAccount(accountId)) {
    throw new WalletSignerError(`${accountId} is a NOVA custodial account; NOVA signs for it`);
  }
  if (!selector.isSignedIn()) {
    throw new WalletSignerError('No wallet connected');
  }

  const checkWallet = async () => {
    const wallet = await selector.wallet();
    if (wallet.type === 'browser') {
      throw new WalletSignerError(
        `${wallet.metadata.name} opens a new page to sign, which NOVA cannot resume yet. ` +
        'Use an extension or popup wallet (e.g. Meteor, HERE, Nightly).',
      );
    }
    const accounts = await wallet.getAccounts();
    if (!accounts.some((a) => a.accountId === accountId)) {
      throw new WalletSignerError(`The connected wallet does not hold ${accountId}`);
    }
    return wallet;
  };

  await checkWallet();

  return {
    accountId,
    async signAndSendFunctionCall(call: WalletFunctionCall) {
      const wallet = await checkWallet();
      const outcome = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId: call.receiverId,
        actions: [actionCreators.functionCall(call.methodName, call.args, call.gas, call.deposit)],
      });
      return { txHash: txHashFromOutcome(outcome) };
    },
  };
}