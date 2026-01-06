// src/app/api/faucet/request-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair, KeyPairString } from '@near-js/crypto';
import { actionCreators } from '@near-js/transactions';

const NOVA_MASTER_ACCOUNT = 'nova-sdk-6.testnet';
const FAUCET_CONTRACT = 'v2.faucet.nonofficial.testnet';
const FAUCET_REQUEST_AMOUNT = '2000000000000000000000000';

const VALID_NOVA_SUFFIXES = [
  '.nova-sdk-6.testnet',  // Current
  '.nova-sdk-5.testnet',  // Legacy
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('Raw request body:', JSON.stringify(body));
    
    const { accountId } = body;
    console.log('Extracted accountId:', accountId);
    console.log('accountId type:', typeof accountId);

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
      console.log('Validation failed - accountId:', accountId);
      console.log('Expected to end with one of:', VALID_NOVA_SUFFIXES);
      return NextResponse.json(
        { success: false, error: 'Can only fund NOVA subaccounts' },
        { status: 400 }
      );
    }

    console.log('Validation passed, proceeding with funding for:', accountId);

    // Get master account private key from environment variable
    const privateKey = process.env.NEAR_CREATOR_PRIVATE_KEY;

    if (!privateKey) {
      console.error('NEAR_CREATOR_PRIVATE_KEY not set');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    console.log(`Funding NOVA account: ${accountId}`);

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
      console.log('Faucet refill successful');
    } catch (faucetError) {
      console.log('Faucet request error:', faucetError);
    }

    // Step 2: Transfer 2 NEAR to the user's NOVA subaccount
    console.log('About to transfer to receiverId:', accountId);
    
    const result = await masterAccount.transfer({
      receiverId: accountId, 
      amount: BigInt('2000000000000000000000000'), // 2 NEAR in yoctoNEAR
    });

    console.log('Transfer result receiver:', result.transaction?.receiver_id);
    console.log('Transfer successful:', JSON.stringify(result, null, 2));

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
    console.error('Funding error:', error);

    // Parse common faucet errors
    const errorMessage = error instanceof Error ? error.message : 'Failed to request tokens';
    
    // Check if master account is out of funds
    if (errorMessage.includes('NotEnoughBalance') || errorMessage.includes('LackBalanceForState')) {
      return NextResponse.json(
        { success: false, error: 'Faucet temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}