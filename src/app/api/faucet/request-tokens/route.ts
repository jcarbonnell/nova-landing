// src/app/api/faucet/request-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { KeyPair } from '@near-js/crypto';
import { actionCreators } from '@near-js/transactions';

const SHADE_API_URL = process.env.SHADE_API_URL || 'https://nova-shade-agent-quiet-frost-9545.fly.dev';
const FAUCET_CONTRACT = 'v2.faucet.nonofficial.testnet';

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'Account ID is required' },
        { status: 400 }
      );
    }

    console.log(`Requesting faucet tokens for account: ${accountId}`);

    // Retrieve private key from Shade TEE
    const shadeResponse = await fetch(`${SHADE_API_URL}/api/user-keys/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
    });

    if (!shadeResponse.ok) {
      const errorText = await shadeResponse.text();
      console.error('Shade key retrieval failed:', errorText);
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve account key from Shade TEE' },
        { status: 500 }
      );
    }

    const { private_key } = await shadeResponse.json();

    if (!private_key) {
      return NextResponse.json(
        { success: false, error: 'No private key found for account' },
        { status: 404 }
      );
    }

    // Setup using new @near-js/* packages
    const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
    
    // Create KeyPairSigner from the private key
    const keyPair = KeyPair.fromString(private_key);
    const signer = new KeyPairSigner(keyPair);
    
    // Create Account with provider and signer
    const account = new Account(accountId, provider, signer);

    // Use signAndSendTransaction for proper FinalExecutionOutcome return type
    const result = await account.signAndSendTransaction({
      receiverId: FAUCET_CONTRACT,
      actions: [
        actionCreators.functionCall(
          'request_near',
          {
            receiver_id: accountId,
            request_amount: '10000000000000000000000000', // 10 NEAR in yoctoNEAR
          },
          BigInt('30000000000000'), // 30 TGas
          BigInt('0') // 0 deposit
        ),
      ],
    });

    console.log('Faucet request successful:', JSON.stringify(result, null, 2));

    // Extract transaction hash - result is FinalExecutionOutcome
    const txHash = result.transaction?.hash || result.transaction_outcome?.id || 'unknown';

    return NextResponse.json({
      success: true,
      accountId,
      txHash,
      message: 'Successfully requested testnet tokens',
    });

  } catch (error) {
    console.error('Faucet request error:', error);

    // Parse common faucet errors
    const errorMessage = error instanceof Error ? error.message : 'Failed to request tokens';
    
    // Check for rate limiting or blacklist errors
    if (errorMessage.includes('recently')) {
      return NextResponse.json(
        { success: false, error: 'Please wait before requesting tokens again (rate limited)' },
        { status: 429 }
      );
    }
    
    if (errorMessage.includes('blacklist')) {
      return NextResponse.json(
        { success: false, error: 'Account is blacklisted from the faucet' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}