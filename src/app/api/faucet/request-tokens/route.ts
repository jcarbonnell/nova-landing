// src/app/api/faucet/request-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair } from '@near-js/crypto';
import { actionCreators } from '@near-js/transactions';

const SHADE_API_URL = process.env.SHADE_API_URL || 'https://nova-shade-agent-quiet-frost-9545.fly.dev';
const FAUCET_CONTRACT = 'v2.faucet.nonofficial.testnet';
const NOVA_MASTER_ACCOUNT = 'nova-sdk-5.testnet';
const TRANSFER_AMOUNT = '2000000000000000000000000';
const FAUCET_REQUEST_AMOUNT = '2000000000000000000000000';

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'Account ID is required' },
        { status: 400 }
      );
    }

    // Verify this is a NOVA subaccount
    if (!accountId.endsWith(`.${NOVA_MASTER_ACCOUNT}`)) {
      return NextResponse.json(
        { success: false, error: 'Can only fund NOVA subaccounts' },
        { status: 400 }
      );
    }

    console.log(`Funding NOVA account: ${accountId}`);

    // Retrieve master account private key from Shade TEE
    const shadeResponse = await fetch(`${SHADE_API_URL}/api/user-keys/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: NOVA_MASTER_ACCOUNT }),
    });

    if (!shadeResponse.ok) {
      const errorText = await shadeResponse.text();
      console.error('Shade key retrieval failed:', errorText);
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve master account key from Shade TEE' },
        { status: 500 }
      );
    }

    const { private_key } = await shadeResponse.json();

    if (!private_key) {
      return NextResponse.json(
        { success: false, error: 'No private key found for master account' },
        { status: 404 }
      );
    }

    // Setup using new @near-js/* packages
    const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
    
    // Create KeyPairSigner from the private key
    const keyPair = KeyPair.fromString(private_key);
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
    } catch (error) {
      console.log('Faucet request error:', error);
    }

    // Step 2: Transfer 2 NEAR to the user's NOVA subaccount
    const result = await masterAccount.transfer({
      receiverId: accountId, 
      amount: BigInt(TRANSFER_AMOUNT)
    });

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