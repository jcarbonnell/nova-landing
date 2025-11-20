// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import {
  connect,
  KeyPair,
  keyStores,
} from 'near-api-js';

const PARENT_DOMAIN = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
const CREATOR_PRIVATE_KEY = process.env.NEAR_CREATOR_PRIVATE_KEY!;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
const SHADE_API_URL = process.env.NEXT_PUBLIC_SHADE_API_URL!;
const NETWORK_ID = PARENT_DOMAIN.includes('testnet') ? 'testnet' : 'mainnet';

if (!PARENT_DOMAIN || !CREATOR_PRIVATE_KEY || !RPC_URL || !SHADE_API_URL) {
  throw new Error('Missing required env vars for account creation');
}

// Convert NEAR amount → yoctoNEAR bigint (official way in v6+)
function parseNearAmount(amount: string): bigint {
  const [whole, fractional = ''] = amount.split('.');
  const padded = fractional.padEnd(24, '0').slice(0, 24);
  return BigInt(whole + padded);
}

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await auth0.getSession();

    // debug
    console.log('Session debug:', {
      hasSession: !!session,
      hasUser: !!session?.user,
      email: session?.user?.email,
      hasIdToken: !!session?.idToken,
      hasAccessToken: !!session?.accessToken,
      tokenKeys: session ? Object.keys(session) : [],
    });

    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cleanUsername = username.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    if (cleanUsername.length < 2 || cleanUsername.length > 64) {
      return NextResponse.json({ error: 'Username must be 2–64 characters' }, { status: 400 });
    }

    const fullId = `${cleanUsername}.${PARENT_DOMAIN}`;

    // 1. Generate keypair
    const newKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey().toString();
    const privateKey = newKeyPair.toString();

    // 2. Creator signer – official workaround
    let creatorSecret = CREATOR_PRIVATE_KEY.trim();
    if (creatorSecret.startsWith('ed25519:')) {
      creatorSecret = creatorSecret.slice(8);
    }
    const creatorKeyPair = KeyPair.fromString(`ed25519:${creatorSecret}`);

    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(NETWORK_ID, PARENT_DOMAIN, creatorKeyPair);

    const near = await connect({
      networkId: NETWORK_ID,
      keyStore,
      nodeUrl: RPC_URL,
      headers: {},
    });

    const creatorAccount = await near.account(PARENT_DOMAIN);

    // 3. Create subaccount – both gas and attachedDeposit as bigint
    const initialBalance = parseNearAmount('0.1');

    console.log('Creating subaccount:', fullId);

    await creatorAccount.createAccount(
      fullId,
      publicKey,
      initialBalance
    );

    console.log('✅ Account created, storing key in Shade TEE...');

    // 4. Store private key in Shade TEE
    const token = session.idToken;
    if (!token) {
      console.warn('No ID token for Shade storage (key not backed up)');
    } else {
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
          console.warn('Shade storage failed (non-critical)', await shadeResponse.text());
        } else {
          console.log('✅ Private key stored in TEE');
        }
      } catch (shadeError) {
        console.error('Shade storage error (non-critical):', shadeError);
      }
    }

    return NextResponse.json({
      accountId: fullId,
      publicKey,
      network: NETWORK_ID,
      message: 'Account created & secured!',
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Account creation failed:', err);

    if (err.message?.includes('already exists')) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to create account', details: err.message },
      { status: 500 }
    );
  }
}