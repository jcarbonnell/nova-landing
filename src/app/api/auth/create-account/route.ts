// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { connect, KeyPair, keyStores, utils } from 'near-api-js';

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

    console.log('Session debug:', {
      hasSession: !!session,
      hasUser: !!session?.user,
      email: session?.user?.email,
      hasIdToken: !!session?.idToken,
      hasAccessToken: !!session?.accessToken,
      sessionKeys: session ? Object.keys(session) : [],
    });

    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cleanUsername = username.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    if (cleanUsername.length < 2 || cleanUsername.length > 64) {
      return NextResponse.json({ error: 'Username must be 2–64 characters' }, { status: 400 });
    }

    const fullId = `${cleanUsername}.${PARENT_DOMAIN}`;

    console.log('Creating account:', { fullId, network: NETWORK_ID });

    // 1. Generate new keypair for subaccount
    const newKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString();
    const privateKey = newKeyPair.toString();

    console.log('Generated keypair:', { publicKey });

    // 2. Setup creator keystore
    const keyStore = new keyStores.InMemoryKeyStore();
    let creatorKeyPair;
    try {
      creatorKeyPair = KeyPair.fromString(CREATOR_PRIVATE_KEY);
      console.log('Creator public key:', creatorKeyPair.getPublicKey().toString());
      await keyStore.setKey(NETWORK_ID, PARENT_DOMAIN, creatorKeyPair);
    } catch (error) {
      throw new Error(`Invalid CREATOR_PRIVATE_KEY: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // 3. Connect to NEAR
    const connectionConfig = {
      networkId: NETWORK_ID,
      keyStore,
      nodeUrl: RPC_URL,
      walletUrl: NETWORK_ID === 'testnet' 
        ? 'https://testnet.mynearwallet.com'
        : 'https://app.mynearwallet.com',
      helperUrl: NETWORK_ID === 'testnet'
        ? 'https://helper.testnet.near.org'
        : 'https://helper.mainnet.near.org',
    };

    console.log('Connecting to NEAR...');
    const near = await connect(connectionConfig);

    // 4. Get creator account
    const creatorAccount = await near.account(PARENT_DOMAIN);
    console.log('Creator account loaded:', PARENT_DOMAIN);

    // 5. Verify creator balance
    try {
      const state = await creatorAccount.state();
      const balance = Number(state.amount) / 1e24;
      console.log(`Creator balance: ${balance} NEAR`);
      if (balance < 0.15) {
        throw new Error(`Insufficient balance in ${PARENT_DOMAIN}: ${balance} NEAR`);
      }
    } catch (error) {
      console.error('Balance check failed:', error);
      // Continue anyway
    }

    // 6. Create subaccount (exact same as your old code)
    console.log('Creating subaccount:', {
      parent: PARENT_DOMAIN,
      child: fullId,
      balance: '0.1 NEAR',
    });

    const initialBalance = utils.format.parseNearAmount('0.1');

    await creatorAccount.createAccount(
      fullId,
      publicKey,
      initialBalance
    );

    console.log('✅ Account created successfully on NEAR blockchain');

    // 7. Store private key in Shade TEE
    const token = (session.idToken || session.accessToken) as string | undefined;

    console.log('Token for Shade:', {
      hasIdToken: !!session.idToken,
      hasAccessToken: !!session.accessToken,
      usingToken: token ? token.substring(0, 30) + '...' : 'NONE',
    });

    if (!token) {
      console.warn('⚠️ No token for Shade storage - key NOT backed up');
      return NextResponse.json({
        accountId: fullId,
        publicKey,
        network: NETWORK_ID,
        message: 'Account created (WARNING: Key not backed up in TEE)',
      });
    }

    try {
      const shadeResponse = await fetch(`${SHADE_API_URL}/api/user-keys/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          account_id: fullId,
          private_key: privateKey,
          public_key: publicKey,
          network: NETWORK_ID,
          auth_token: token,
        }),
      });

      if (!shadeResponse.ok) {
        const errorText = await shadeResponse.text();
        console.error('❌ Shade storage failed:', errorText);

        return NextResponse.json({
          accountId: fullId,
          publicKey,
          network: NETWORK_ID,
          message: 'Account created (WARNING: Key storage failed)',
          shadeError: errorText.substring(0, 200),
        });
      }

      const shadeData = await shadeResponse.json();
      console.log('✅ Private key stored in TEE:', shadeData.checksum?.substring(0, 16));

    } catch (shadeError) {
      console.error('❌ Shade storage error:', shadeError);

      return NextResponse.json({
        accountId: fullId,
        publicKey,
        network: NETWORK_ID,
        message: 'Account created (WARNING: Key storage error)',
      });
    }

    const explorerUrl = NETWORK_ID === 'testnet'
      ? `https://testnet.nearblocks.io/txns/${fullId}`
      : `https://nearblocks.io/txns/${fullId}`;

    return NextResponse.json({
      accountId: fullId,
      publicKey,
      network: NETWORK_ID,
      explorerUrl,
      message: 'Account created & secured in TEE!',
    });

  } catch (error: unknown) {
    const err = error as Error;
    console.error('❌ Account creation failed:', err.message);
    console.error('Stack:', err.stack);

    if (err.message?.includes('already exists') || err.message?.includes('AlreadyExists')) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to create account', details: err.message },
      { status: 500 }
    );
  }
}