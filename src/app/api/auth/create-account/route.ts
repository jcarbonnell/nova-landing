// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { Account } from '@near-js/accounts';
import { KeyPair } from '@near-js/crypto';
import { InMemoryKeyStore } from '@near-js/keystores';
import { JsonRpcProvider } from '@near-js/providers';


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
    const publicKey = newKeyPair.getPublicKey();
    const privateKey = newKeyPair.toString();

    console.log('Generated keypair:', {
      publicKey: publicKey.toString(),
    });

    // 2. Setup creator account keystore
    let creatorSecret = CREATOR_PRIVATE_KEY.trim();
    if (creatorSecret.startsWith('ed25519:')) {
      creatorSecret = creatorSecret.slice(8);
    }

    const creatorKeyPair = KeyPair.fromString(`ed25519:${creatorSecret}`);
    const keyStore = new InMemoryKeyStore();
    await keyStore.setKey(NETWORK_ID, PARENT_DOMAIN, creatorKeyPair);

    // 3. Initialize provider
    const provider = new JsonRpcProvider({ url: RPC_URL });

    // 4. Create creator account instance WITHOUT signer
    // Account will create its own internal signer when needed
    const creatorAccount = new Account(PARENT_DOMAIN, provider);
    
    // ✅ Manually set the signer using the setSigner method
    // Create a minimal signer object that implements the required interface
    const signer = {
      async getPublicKey() {
        return creatorKeyPair.getPublicKey();
      },
      async signTransaction(transaction: { encode: () => Uint8Array }) {
        const message = transaction.encode();
        const signature = creatorKeyPair.sign(message);
        return [signature, transaction];
      },
      async signDelegateAction(delegateAction: { encode: () => Uint8Array }) {
        const message = delegateAction.encode();
        const signature = creatorKeyPair.sign(message);
        return [signature, delegateAction];
      },
      async signNep413Message(message: string, accountId: string, recipient: string, nonce: Uint8Array) {
        const payload = JSON.stringify({ message, recipient, nonce: Array.from(nonce) });
        const signature = creatorKeyPair.sign(Buffer.from(payload));
        return {
          accountId,
          publicKey: creatorKeyPair.getPublicKey().toString(),
          signature: signature.toString(),
          message,
          recipient,
          nonce,
        };
      },
    };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    creatorAccount.setSigner(signer as any);

    console.log('Creating subaccount:', {
      parent: PARENT_DOMAIN,
      child: fullId,
      balance: '0.1 NEAR',
    });

    // 5. Create account
    const initialBalance = '100000000000000000000000';
    
    const result = await creatorAccount.createAccount(
      fullId,
      publicKey.toString(),
      initialBalance
    );

    console.log('Transaction result:', {
      status: result.status,
      transactionHash: result.transaction.hash,
    });

    // Check if transaction succeeded
    if (typeof result.status === 'object' && 'SuccessValue' in result.status) {
      console.log('✅ Account created successfully on NEAR blockchain');
    } else if (typeof result.status === 'object' && 'Failure' in result.status) {
      throw new Error(`Account creation failed: ${JSON.stringify(result.status.Failure)}`);
    }

    // 6. Store private key in Shade TEE
    const token = typeof session.idToken === 'string' 
      ? session.idToken 
      : typeof session.accessToken === 'string' 
        ? session.accessToken 
        : undefined;

    console.log('Token for Shade:', {
      hasIdToken: !!session.idToken,
      hasAccessToken: !!session.accessToken,
      usingToken: token ? token.substring(0, 30) + '...' : 'NONE',
    });

    if (!token) {
      console.warn('⚠️ No token for Shade storage - key NOT backed up');
      return NextResponse.json({
        accountId: fullId,
        publicKey: publicKey.toString(),
        network: NETWORK_ID,
        transaction: result.transaction.hash,
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
          public_key: publicKey.toString(),
          network: NETWORK_ID,
          auth_token: token,
        }),
      });

      if (!shadeResponse.ok) {
        const errorText = await shadeResponse.text();
        console.error('❌ Shade storage failed:', errorText);

        return NextResponse.json({
          accountId: fullId,
          publicKey: publicKey.toString(),
          network: NETWORK_ID,
          transaction: result.transaction.hash,
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
        publicKey: publicKey.toString(),
        network: NETWORK_ID,
        transaction: result.transaction.hash,
        message: 'Account created (WARNING: Key storage error)',
      });
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