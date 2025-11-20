// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import {
  connect,
  KeyPair,
  keyStores,
  transactions,
  utils,
} from 'near-api-js';

const PARENT_DOMAIN = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
const CREATOR_PRIVATE_KEY = process.env.NEAR_CREATOR_PRIVATE_KEY!;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const SHADE_API_URL = process.env.NEXT_PUBLIC_SHADE_API_URL!;

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
      return NextResponse.json({ error: 'Username must be 2–64 chars' }, { status: 400 });
    }

    const fullId = `${cleanUsername}.${PARENT_DOMAIN}`;

    // === 1. Generate new keypair ===
    const newKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString();
    const privateKey = newKeyPair.toString(); // "ed25519:..."

    // === 2. Setup creator signer (fixed for near-api-js v6+) ===
    const networkId = PARENT_DOMAIN.includes('testnet') ? 'testnet' : 'mainnet';

    const creatorSecretKey = CREATOR_PRIVATE_KEY.startsWith('ed25519:')
      ? CREATOR_PRIVATE_KEY.slice(8) // strip prefix
      : CREATOR_PRIVATE_KEY;

    const creatorKeyPair = KeyPair.fromString(creatorSecretKey);

    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(networkId, PARENT_DOMAIN, creatorKeyPair);

    const near = await connect({
      networkId,
      keyStore,
      nodeUrl: RPC_URL,
      headers: {},
    });

    const creatorAccount = await near.account(PARENT_DOMAIN);

    // === 3. Create subaccount ===
    const initialBalance = utils.format.parseNearAmount('0.1')!; // 0.1 NEAR

    console.log('Creating account:', { fullId, publicKey, initialBalance: '0.1 NEAR' });

    const createTx = await creatorAccount.functionCall({
      contractId: 'testnet', // near-api-js requires this for createAccount
      methodName: 'create_account',
      args: {
        new_account_id: fullId,
        new_public_key: publicKey,
      },
      gas: '300000000000000', // 300 TGas
      attachedDeposit: initialBalance,
    });

    // === 4. Store private key in Shade TEE ===
    const accessToken = session.accessToken;
    if (!accessToken) throw new Error('No access token');

    const shadeResponse = await fetch(`${SHADE_API_URL}/api/user-keys/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        account_id: fullId,
        private_key: privateKey,
        public_key: publicKey,
        network: networkId,
        auth_token: accessToken,
      }),
    });

    if (!shadeResponse.ok) {
      const err = await shadeResponse.text();
      console.error('Shade store failed:', err);
      // Don't fail the whole flow — user can recover later
    } else {
      console.log('Private key securely stored in TEE');
    }

    return NextResponse.json({
      accountId: fullId,
      publicKey,
      network: networkId,
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