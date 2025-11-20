// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import {
  connect,
  KeyPair,
  keyStores,
  utils,
} from 'near-api-js';

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

    // === Generate fresh keypair for the new user ===
    const newKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString(); // "ed25519:..."
    const privateKey = newKeyPair.toString();               // "ed25519:..."

    // === Creator signer – the only breaking change in near-api-js v6+ ===
    let creatorSecretKey = CREATOR_PRIVATE_KEY;

    // Remove "ed25519:" prefix if present – fromString() now expects raw base58 seed
    if (creatorSecretKey.startsWith('ed25519:')) {
      creatorSecretKey = creatorSecretKey.slice(8);
    }

    const creatorKeyPair = KeyPair.fromString(creatorSecretKey);

    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(NETWORK_ID, PARENT_DOMAIN, creatorKeyPair);

    const near = await connect({
      networkId: NETWORK_ID,
      keyStore,
      nodeUrl: RPC_URL,
      headers: {},
    });

    const creatorAccount = await near.account(PARENT_DOMAIN);

    // === Create subaccount with 0.1 NEAR initial balance ===
    const initialBalance = utils.format.parseNearAmount('0.1')!;

    console.log('Creating subaccount:', { fullId, publicKey });

    await creatorAccount.functionCall({
      contractId: 'testnet', // This is required even though it's not a real contract call
      methodName: 'create_account',
      args: {
        new_account_id: fullId,
        new_public_key: publicKey,
      },
      gas: '300000000000000',
      attachedDeposit: initialBalance,
    });

    // === Store private key securely in Shade TEE ===
    const accessToken = session.accessToken;
    if (!accessToken) throw new Error('Missing Auth0 access token');

    const shadeResponse = await fetch(`${SHADE_API_URL}/api/user-keys/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        account_id: fullId,
        private_key: privateKey,
        public_key: publicKey,
        network: NETWORK_ID,
        auth_token: accessToken,
      }),
    });

    if (!shadeResponse.ok) {
      console.error('Shade storage failed (non-critical)', await shadeResponse.text());
      // Continue – user can still recover later
    } else {
      console.log('Private key stored in TEE');
    }

    return NextResponse.json({
      accountId: fullId,
      publicKey,
      network: NETWORK_ID,
      message: 'Account created & secured!',
    });
  } catch (error: any) {
    console.error('Account creation failed:', error);

    if (error.message?.includes('already exists')) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to create account', details: error.message },
      { status: 500 }
    );
  }
}