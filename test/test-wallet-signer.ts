// nova-landing/test/test-wallet-signer.ts
// Deliverable 2 (A): standalone harness for the wallet-selector adapter.
//   npx tsx scripts/test-wallet-signer.ts
// No browser, no wallet, no network: a mocked WalletSelector.
import assert from 'node:assert/strict';
import { createWalletSigner, txHashFromOutcome, isCustodialAccount } from '../src/lib/wallet-signer';

const ACCOUNT = 'alice.near';
const CALL = {
  receiverId: 'nova-sdk.near',
  methodName: 'record_transaction',
  args: { group_id: 'g', user_id: ACCOUNT, file_hash: 'ab'.repeat(32), ipfs_hash: 'loc', backend: 'FastFS' },
  gas: BigInt('100000000000000'),
  deposit: BigInt('25600000000000000000'),
};
const OK_OUTCOME = {
  status: { SuccessValue: '' },
  transaction: { hash: 'HASH_FROM_TX' },
  transaction_outcome: { id: 'HASH_FROM_OUTCOME', outcome: {} },
};

type Mock = { selector: any; sent: any[]; state: any };
function mock(over: Partial<{ type: string; accounts: string[]; signedIn: boolean; outcome: unknown; reject: boolean }> = {}): Mock {
  const state = {
    type: over.type ?? 'injected',
    accounts: over.accounts ?? [ACCOUNT],
    signedIn: over.signedIn ?? true,
    outcome: 'outcome' in over ? over.outcome : OK_OUTCOME,
    reject: over.reject ?? false,
  };
  const sent: any[] = [];
  const selector = {
    isSignedIn: () => state.signedIn,
    wallet: async () => ({
      id: 'mock', type: state.type, metadata: { name: 'MockWallet' },
      getAccounts: async () => state.accounts.map((accountId) => ({ accountId })),
      signAndSendTransaction: async (p: any) => {
        sent.push(p);
        if (state.reject) throw new Error('User rejected the request');
        return state.outcome;
      },
    }),
  };
  return { selector, sent, state };
}

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
async function rejects(p: Promise<unknown>, needle: string) {
  try { await p; } catch (e) {
    assert.ok((e as Error).message.toLowerCase().includes(needle.toLowerCase()), `wrong error: ${(e as Error).message}`);
    return;
  }
  throw new Error(`expected rejection containing "${needle}"`);
}

async function main() {
  await test('W1 signs exactly one FunctionCall with the SDK call, as the session account', async () => {
    const m = mock();
    const signer = await createWalletSigner(m.selector, ACCOUNT);
    const { txHash } = await signer.signAndSendFunctionCall(CALL);
    assert.equal(txHash, 'HASH_FROM_OUTCOME');
    assert.equal(m.sent.length, 1);
    const p = m.sent[0];
    assert.equal(p.signerId, ACCOUNT);
    assert.equal(p.receiverId, 'nova-sdk.near');
    assert.equal(p.actions.length, 1);
    const fc = p.actions[0].functionCall;
    assert.ok(fc, 'action is not a FunctionCall');
    assert.equal(fc.methodName, 'record_transaction');
    assert.deepEqual(JSON.parse(Buffer.from(fc.args).toString()), CALL.args);
    assert.equal(BigInt(fc.gas), CALL.gas);
    assert.equal(BigInt(fc.deposit), CALL.deposit);
  });

  await test('W2 custodial accounts are refused before any prompt', async () => {
    const m = mock({ accounts: ['bob.nova-sdk.near'] });
    await rejects(createWalletSigner(m.selector, 'bob.nova-sdk.near'), 'custodial');
    await rejects(createWalletSigner(m.selector, 'bob.nova-sdk-7.testnet'), 'custodial');
    assert.equal(m.sent.length, 0);
  });

  await test('W3 redirect (browser) wallets are refused before any prompt', async () => {
    const m = mock({ type: 'browser' });
    await rejects(createWalletSigner(m.selector, ACCOUNT), 'opens a new page');
    assert.equal(m.sent.length, 0);
  });

  await test('W4 a wallet switched to a redirect wallet after creation is refused at call time', async () => {
    const m = mock();
    const signer = await createWalletSigner(m.selector, ACCOUNT);
    m.state.type = 'browser';
    await rejects(signer.signAndSendFunctionCall(CALL), 'opens a new page');
    assert.equal(m.sent.length, 0);
  });

  await test('W5 a wallet that does not hold the account is refused (at creation and at call time)', async () => {
    await rejects(createWalletSigner(mock({ accounts: ['mallory.near'] }).selector, ACCOUNT), 'does not hold');
    const m = mock();
    const signer = await createWalletSigner(m.selector, ACCOUNT);
    m.state.accounts = ['mallory.near'];
    await rejects(signer.signAndSendFunctionCall(CALL), 'does not hold');
    assert.equal(m.sent.length, 0);
  });

  await test('W6 no wallet connected is refused', async () => {
    await rejects(createWalletSigner(mock({ signedIn: false }).selector, ACCOUNT), 'no wallet connected');
  });

  await test('W7 a declined signature propagates (SDK then stops: no MCP step)', async () => {
    const signer = await createWalletSigner(mock({ reject: true }).selector, ACCOUNT);
    await rejects(signer.signAndSendFunctionCall(CALL), 'rejected');
  });

  await test('W8 void outcome (redirect) and on-chain Failure are errors, never a hash', async () => {
    for (const [outcome, needle] of [
      [undefined, 'no transaction outcome'],
      [{ ...OK_OUTCOME, status: { Failure: { ActionError: {} } } }, 'failed on chain'],
      [{ ...OK_OUTCOME, status: 'Failure' }, 'failed on chain'],
      [{ status: { SuccessValue: '' } }, 'no transaction hash'],
    ] as const) {
      const signer = await createWalletSigner(mock({ outcome }).selector, ACCOUNT);
      await rejects(signer.signAndSendFunctionCall(CALL), needle);
    }
  });

  await test('W9 hash falls back to transaction.hash when transaction_outcome is absent', async () => {
    assert.equal(txHashFromOutcome({ status: { SuccessValue: '' }, transaction: { hash: 'H2' } }), 'H2');
  });

  await test('W10 custody suffix check is exact', async () => {
    assert.ok(isCustodialAccount('carol.nova-sdk.near'));
    assert.ok(isCustodialAccount('Carol.Nova-SDK.near'));
    for (const a of ['alice.near', 'nova-sdk.near', 'evil-nova-sdk.near', 'x.nova-sdk.near.evil.near']) {
      assert.ok(!isCustodialAccount(a), a);
    }
  });

  console.log(`\n${10 - failed}/10 passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });