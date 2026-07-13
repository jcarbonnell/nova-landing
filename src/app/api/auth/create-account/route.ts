// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getAuthToken } from '@/lib/auth0';
import { Account } from '@near-js/accounts';
import { KeyPair, type KeyPairString } from '@near-js/crypto';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';

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
    const { username, email, wallet_id } = await req.json();

    // 1. Wallet branch DISABLED (v0.4).
    // Re-enabled in v0.5 behind NEP-413 challenge/response
    if (wallet_id) {
      return NextResponse.json({
        error: 'Wallet auth disabled pending self-custody migration (v0.5)',
        code: 'WALLET_AUTH_PENDING_SELF_CUSTODY',
      }, { status: 501 });
    }

    // 2. Validate inputs
    if (!username) {
      return NextResponse.json({ error: 'Username required' }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // 3. verify the Auth0 session owns the claimed email.
    const session = await auth0.getSession();
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 4. Acquire the Shade auth token BEFORE sending any NEAR.
    const token = await getAuthToken();
    if (!token) {
      return NextResponse.json({ error: 'No authentication token available' }, { status: 401 });
    }

    // 5. Validate Username
    const cleanUsername = username.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    if (cleanUsername.length < 2 || cleanUsername.length > 64) {
      return NextResponse.json({ error: 'Username must be 2–64 characters' }, { status: 400 });
    }
    const fullId = `${cleanUsername}.${PARENT_DOMAIN}`;
  
    // 6. Generate a keypair for the new NEAR account
    const newKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newKeyPair.getPublicKey();
    const privateKey = newKeyPair.toString();

    // 7. Setup creator key (the key of the account funding the new account)
    let secret = CREATOR_PRIVATE_KEY.trim();
    if (!secret.startsWith('ed25519:')) {
      secret = `ed25519:${secret}`;
    }

    // 8. Create signer
    const signer = KeyPairSigner.fromSecretKey(secret as KeyPairString);

    // 9. Create provider and creator account 
    const provider = new JsonRpcProvider({ url: RPC_URL });
    const creatorAccount = new Account(PARENT_DOMAIN, provider, signer);
    
    // 10. Create account
    const result = await creatorAccount.createAccount(
      fullId,
      publicKey,
      '100000000000000000000000' // allocate 0.1 NEAR
    );

    if (typeof result.status !== 'string' && 'Failure' in result.status) {
      throw new Error(`TX failed: ${JSON.stringify(result.status.Failure)}`);
    }

    console.log('Account created');

    // 11. Store key in Shade TEE
    try {
      const res = await fetch(`${SHADE_API_URL}/api/user-keys/store`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': process.env.INTERNAL_API_SECRET || '',
        },
        body: JSON.stringify({
          email,
          account_id: fullId,
          private_key: privateKey,
          public_key: publicKey.toString(),
          network: NETWORK_ID,
          auth_token: token,
        }),
      });
      if (res.ok) {
        console.log('✅ Key securely stored in Shade TEE');
      } else {
        console.error('⚠️ Shade backup failed:', res.status);
      }
    } catch {
      console.error('❌ Shade backup error (network/timeout)');
    }

    const explorerUrl = NETWORK_ID === 'testnet'
      ? `https://testnet.nearblocks.io/txns/${result.transaction.hash}`
      : `https://nearblocks.io/txns/${result.transaction.hash}`;

    return NextResponse.json({
      accountId: fullId,
      publicKey: publicKey.toString(),
      network: NETWORK_ID,
      transaction: result.transaction.hash,
      explorerUrl,
      message: 'Success!',
      keyBackedUp: true,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Account creation failed:', errorMessage);
    console.error('Full error:', error);
    console.error('Env vars:', {
      PARENT_DOMAIN,
      RPC_URL,
      NETWORK_ID,
      hasCreatorKey: !!CREATOR_PRIVATE_KEY,
    });
    if (errorMessage.includes('already exists')) {
      return NextResponse.json({ error: 'Username taken' }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed', details: errorMessage },
      { status: 500 }
    );
  }
}