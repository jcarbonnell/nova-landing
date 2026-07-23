// src/app/api/faucet/request-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair, KeyPairString } from '@near-js/crypto';
import { actionCreators } from '@near-js/transactions';
import { auth0 } from '@/lib/auth0';
import { log, logError } from '@/lib/log';

const NOVA_MASTER_ACCOUNT = 'nova-sdk-6.testnet';
const FAUCET_CONTRACT = 'v2.faucet.nonofficial.testnet';
const FAUCET_REQUEST_AMOUNT = '2000000000000000000000000';

const VALID_NOVA_SUFFIXES = [
  '.nova-sdk-6.testnet',  // Current
  '.nova-sdk-5.testnet',  // Legacy
];

export async function POST(req: NextRequest) {
  try {
    // GUARD 1 — testnet-only, checked EXPLICITLY.
    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN || '';
    if (!parentDomain.includes('testnet')) {
      return NextResponse.json(
        { success: false, error: 'Faucet is testnet-only' },
        { status: 404 }
      );
    }

    // GUARD 2 — authenticated callers only.
    const session = await auth0.getSession();
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    
    const body = await req.json();
    const { accountId } = body;

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'Account ID is required' },
        { status: 400 }
      );
    }

    // Verify this is a NOVA subaccount
    const isNovaSubaccount = VALID_NOVA_SUFFIXES.some(suffix => 
      accountId.endsWith(suffix)
    );

    if (!isNovaSubaccount) {
      log('faucet_validation_failed', { account_id: accountId });
      return NextResponse.json(
        { success: false, error: 'Can only fund NOVA subaccounts' },
        { status: 400 }
      );
    }

    log('faucet_validation_passed', { account_id: accountId });

    // Get master account private key from environment variable
    const privateKey = process.env.NEAR_CREATOR_PRIVATE_KEY_TESTNET;

    if (!privateKey) {
      logError('faucet_creator_key_missing');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    log('faucet_funding_start', { account_id: accountId });

    // Setup using new @near-js/* packages
    const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
    
    // Create KeyPairSigner from the private key
    const keyPair = KeyPair.fromString(privateKey as KeyPairString);
    const signer = new KeyPairSigner(keyPair);
    
    // Create Account with provider and signer
    const masterAccount = new Account(NOVA_MASTER_ACCOUNT, provider, signer);

    // Step 1: Request tokens from faucet to refill master account
    try {
      await masterAccount.signAndSendTransaction({
        receiverId: FAUCET_CONTRACT,
        actions: [
          actionCreators.functionCall(
            'request_near',
            {
              receiver_id: NOVA_MASTER_ACCOUNT,
              request_amount: FAUCET_REQUEST_AMOUNT, // max 2 NEAR in yoctoNEAR
            },
            BigInt('30000000000000'), // 30 TGas
            BigInt('0') // 0 deposit
          ),
        ],
      });
      log('faucet_refill_success');
    } catch (faucetError) {
      logError('faucet_refill_error', {
        message: faucetError instanceof Error ? faucetError.message : String(faucetError),
      });
    }

    // Step 2: Transfer 2 NEAR to the user's NOVA subaccount
    const result = await masterAccount.transfer({
      receiverId: accountId,
      amount: BigInt('2000000000000000000000000'), // 2 NEAR in yoctoNEAR
    });

    const txHashForLog = result.transaction?.hash || result.transaction_outcome?.id || 'unknown';
    log('faucet_transfer_success', { account_id: accountId, tx_hash: txHashForLog });

    // Extract transaction hash - result is FinalExecutionOutcome
    const txHash = result.transaction?.hash || result.transaction_outcome?.id || 'unknown';

    return NextResponse.json({
      success: true,
      accountId,
      txHash,
      amount: '2 NEAR',
      message: 'Successfully requested testnet tokens',
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to request tokens';
    logError('faucet_error', { message: errorMessage });

    // Check if master account is out of funds
    if (errorMessage.includes('NotEnoughBalance') || errorMessage.includes('LackBalanceForState')) {
      return NextResponse.json(
        { success: false, error: 'Faucet temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to request tokens' },
      { status: 500 }
    );
  }
}