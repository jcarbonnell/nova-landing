// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { connect, KeyPair, keyStores } from 'near-api-js';

const PARENT_DOMAIN = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
const CREATOR_PRIVATE_KEY = process.env.NEAR_CREATOR_PRIVATE_KEY!;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const SHADE_API_URL = process.env.NEXT_PUBLIC_SHADE_API_URL!;
const NETWORK_ID = PARENT_DOMAIN.includes('testnet') ? 'testnet' : 'mainnet';

if (!PARENT_DOMAIN || !CREATOR_PRIVATE_KEY || !RPC_URL || !SHADE_API_URL) {
  throw new Error('Missing required env vars for account creation');
}

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await auth0.getSession();
    
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cleanUsername = username.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    if (cleanUsername.length < 2 || cleanUsername.length > 64) {
      return NextResponse.json({ error: 'Username must be 2–64 characters' }, { status: 400 });
    }

    const fullId = `${cleanUsername}.${PARENT_DOMAIN}`;

    // 1. Generate keypair for new account
    const newKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString();
    const privateKey = newKeyPair.toString();

    console.log('Generated keypair for:', fullId);

    // 2. Setup creator account signer
    let creatorSecret = CREATOR_PRIVATE_KEY.trim();
    if (creatorSecret.startsWith('ed25519:')) {
      creatorSecret = creatorSecret.slice(8);
    }

    const creatorKeyPair = KeyPair.fromString(creatorSecret);
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(NETWORK_ID, PARENT_DOMAIN, creatorKeyPair);

    // 3. Connect to NEAR
    const near = await connect({
      networkId: NETWORK_ID,
      keyStore,
      nodeUrl: RPC_URL,
      headers: {},
    });

    const creatorAccount = await near.account(PARENT_DOMAIN);

    // Check balance
    try {
      const state = await creatorAccount.state();
      const balanceNear = parseFloat(state.amount) / 1e24;
      console.log(`Creator balance: ${balanceNear.toFixed(4)} NEAR`);
      
      if (balanceNear < 0.5) {
        return NextResponse.json(
          { error: 'Insufficient funds in parent account' },
          { status: 500 }
        );
      }
    } catch (err) {
      console.error('Balance check failed:', err);
    }

    // 4. Create subaccount - CORRECT METHOD
    const initialBalance = '100000000000000000000000'; // 0.1 NEAR in yoctoNEAR
    
    console.log('Creating subaccount:', fullId);
    
    const result = await creatorAccount.createAccount(
      fullId,           // accountId
      publicKey,        // publicKey
      initialBalance    // initialBalance (string or bigint)
    );

    const txHash = result.transaction.hash;
    const explorerUrl = NETWORK_ID === 'testnet'
      ? `https://testnet.nearblocks.io/txns/${txHash}`
      : `https://nearblocks.io/txns/${txHash}`;

    console.log('✅ Account created:', fullId, 'tx:', txHash);

    // 5. Store private key in Shade TEE with REAL JWT
    try {
      // Get real JWT - idToken is always present, accessToken might not be
      const authToken = (session as any).idToken || (session as any).accessToken;
      
      if (!authToken) {
        console.error('No JWT token in session:', Object.keys(session));
        throw new Error('No authentication token available');
      }

      console.log('Storing key in Shade with JWT...');
      console.log('Token preview:', authToken.substring(0, 50) + '...');

      const shadeResponse = await fetch(`${SHADE_API_URL}/api/user-keys/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          account_id: fullId,
          private_key: privateKey,
          public_key: publicKey,
          network: NETWORK_ID,
          auth_token: authToken, // ✅ Real JWT
        }),
      });

      if (!shadeResponse.ok) {
        const errorText = await shadeResponse.text();
        console.error('Shade storage failed:', errorText);
        
        // CRITICAL: Account created but key not stored
        console.error('=== EMERGENCY RECOVERY ===');
        console.error('Account ID:', fullId);
        console.error('Private Key:', privateKey);
        console.error('Public Key:', publicKey);
        console.error('Transaction:', txHash);
        console.error('=========================');
        
        return NextResponse.json({
          error: 'Account created but key storage failed',
          accountId: fullId,
          transaction: txHash,
          explorerUrl,
          critical: true,
        }, { status: 500 });
      }

      const shadeData = await shadeResponse.json();
      console.log('✅ Key stored in TEE:', shadeData.checksum);

    } catch (shadeError) {
      console.error('Shade error:', shadeError);
      
      // Account created, log for recovery
      console.error('=== EMERGENCY RECOVERY ===');
      console.error('Account ID:', fullId);
      console.error('Private Key:', privateKey);
      console.error('=========================');
      
      return NextResponse.json({
        error: 'Account created but key storage failed',
        accountId: fullId,
        transaction: txHash,
        critical: true,
      }, { status: 500 });
    }

    // Success!
    return NextResponse.json({
      accountId: fullId,
      publicKey,
      network: NETWORK_ID,
      transaction: txHash,
      explorerUrl,
      message: 'Account created & secured in TEE!',
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('Account creation failed:', err);
    
    if (err.message?.includes('already exists') || err.message?.includes('AlreadyExists')) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }
    
    if (err.message?.includes('insufficient')) {
      return NextResponse.json({ error: 'Insufficient funds' }, { status: 500 });
    }
    
    return NextResponse.json(
      { error: 'Failed to create account', details: err.message },
      { status: 500 }
    );
  }
}