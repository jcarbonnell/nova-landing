// src/app/api/faucet/request-tokens/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Account, connect, keyStores, KeyPair } from 'near-api-js';

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();

    if (!accountId) {
      return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    }

    // Only allow testnet NOVA accounts
    if (!accountId.includes('.nova-sdk') || !accountId.includes('testnet')) {
      return NextResponse.json({ error: 'Only NOVA testnet accounts supported' }, { status: 400 });
    }

    console.log('Requesting faucet tokens for:', accountId);

    // Retrieve the account's private key from Shade TEE
    const shadeUrl = process.env.SHADE_API_URL;
    if (!shadeUrl) {
      return NextResponse.json({ error: 'Shade API not configured' }, { status: 500 });
    }

    const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId }),
    });

    if (!shadeResponse.ok) {
      const errorData = await shadeResponse.json().catch(() => ({}));
      console.error('Shade key retrieval failed:', errorData);
      return NextResponse.json({ error: 'Failed to retrieve account key' }, { status: 500 });
    }

    const { private_key } = await shadeResponse.json();
    if (!private_key) {
      return NextResponse.json({ error: 'No private key found for account' }, { status: 404 });
    }

    // Setup NEAR connection with the user's NOVA account
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(private_key);
    await keyStore.setKey('testnet', accountId, keyPair);

    const near = await connect({
      networkId: 'testnet',
      keyStore,
      nodeUrl: 'https://rpc.testnet.near.org',
    });

    const account = await near.account(accountId);

    // Call the faucet contract - the NOVA account requests funds for itself
    const result = await account.functionCall({
      contractId: 'faucet.nonofficial.testnet',
      methodName: 'request_funds',
      args: {
        receiver_id: accountId,
        amount: '10000000000000000000000000', // 10 NEAR in yoctoNEAR
      },
      gas: BigInt('30000000000000'), // 30 TGas
      attachedDeposit: BigInt('0'),
    });

    console.log('Faucet transaction successful for:', accountId);

    return NextResponse.json({ 
      success: true, 
      accountId,
      txHash: result.transaction.hash 
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Faucet request error:', errMsg);

    // Handle common faucet errors
    if (errMsg.includes('REQUEST_GAP') || errMsg.includes('too soon')) {
      return NextResponse.json({ error: 'Rate limited. Please wait before requesting more tokens.' }, { status: 429 });
    }
    if (errMsg.includes('blacklist')) {
      return NextResponse.json({ error: 'Account temporarily blocked. Try again later.' }, { status: 403 });
    }
    if (errMsg.includes('NotEnoughBalance')) {
      return NextResponse.json({ error: 'Account needs initial funding. Please try the manual faucet at near-faucet.io' }, { status: 400 });
    }

    return NextResponse.json({ error: `Failed to request tokens: ${errMsg}` }, { status: 500 });
  }
}