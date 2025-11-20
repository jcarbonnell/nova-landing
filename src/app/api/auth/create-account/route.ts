// src/app/api/auth/create-account/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair } = nearAPI;

if (!process.env.NEXT_PUBLIC_PARENT_DOMAIN) {
  throw new Error('NEXT_PUBLIC_PARENT_DOMAIN is required');
}

if (!process.env.NEAR_CREATOR_PRIVATE_KEY) {
  throw new Error('NEAR_CREATOR_PRIVATE_KEY is required for account creation');
}

if (!process.env.NEXT_PUBLIC_SHADE_API_URL) {
  throw new Error('NEXT_PUBLIC_SHADE_API_URL is required for key storage');
}

export async function POST(req: NextRequest) {
  try {
    const { username, email } = await req.json();
    const session = await auth0.getSession();
    
    if (!session?.user?.email || session.user.email !== email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN!;
    const cleanUsername = username.includes('.') ? username.split('.')[0] : username;
    const fullId = `${cleanUsername}.${parentDomain}`;

    // Validate format
    const domainEscaped = parentDomain.replace(/\./g, '\\.');
    const regex = new RegExp(`^[a-z0-9_-]{2,64}\\.${domainEscaped}$`);
    
    if (!regex.test(fullId)) {
      console.error('Validation failed:', { fullId, pattern: regex.source });
      return NextResponse.json(
        { error: `Invalid account ID format (must end with .${parentDomain})` },
        { status: 400 }
      );
    }

    // Determine network
    const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK !== 'mainnet';
    const networkId = isTestnet ? 'testnet' : 'mainnet';
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL!;

    console.log('Creating NEAR account via direct RPC:', { 
      username: cleanUsername, 
      fullId, 
      email,
      network: networkId,
      parent: parentDomain
    });

    // Generate keypair for the new account
    const newAccountKeyPair = KeyPair.fromRandom('ed25519');
    const publicKey = newAccountKeyPair.getPublicKey().toString();
    const privateKey = newAccountKeyPair.toString();

    console.log('Generated keypair:', { 
      accountId: fullId, 
      publicKey 
    });

    // Setup in-memory keystore
    const keyStore = new keyStores.InMemoryKeyStore();
    
    // Add creator's key
    const creatorAccountId = parentDomain;
    const creatorPrivateKey = process.env.NEAR_CREATOR_PRIVATE_KEY!;
    
    // Validate creator key format
    if (!creatorPrivateKey.startsWith('ed25519:')) {
      throw new Error('NEAR_CREATOR_PRIVATE_KEY must start with "ed25519:"');
    }
    
    const creatorKeyPair = KeyPair.fromString(creatorPrivateKey as `ed25519:${string}`);
    await keyStore.setKey(networkId, creatorAccountId, creatorKeyPair);

    // Connect to NEAR
    const nearConnection = await connect({
      networkId,
      keyStore,
      nodeUrl: rpcUrl,
      walletUrl: isTestnet 
        ? 'https://testnet.mynearwallet.com/' 
        : 'https://app.mynearwallet.com/',
      helperUrl: isTestnet 
        ? 'https://helper.testnet.near.org' 
        : 'https://helper.mainnet.near.org',
    });

    const creatorAccount = await nearConnection.account(creatorAccountId);

    // Check creator account balance
    try {
      const accountState = await creatorAccount.state();
      const balanceInNear = Number(accountState.amount) / 1e24;
      console.log(`Creator account balance: ${balanceInNear.toFixed(4)} NEAR`);
      
      // Minimum balance check
      const minRequired = 0.5;
      if (balanceInNear < minRequired) {
        console.error(`Insufficient balance: ${balanceInNear} NEAR < ${minRequired} NEAR`);
        return NextResponse.json(
          { error: `Insufficient funds in parent account. Please contact support.` },
          { status: 500 }
        );
      }
    } catch (balanceError) {
      console.error('Failed to check creator balance:', balanceError);
    }

    // Initial balance: 0.1 NEAR for both testnet and mainnet
    const initialBalance = '100000000000000000000000'; // 0.1 NEAR in yoctoNEAR
    const initialBalanceNear = 0.1;

    console.log('Creating subaccount:', {
      parent: creatorAccountId,
      child: fullId,
      initialBalance: `${initialBalanceNear} NEAR`,
      publicKey,
    });

    try {
      // Create the subaccount
      const result = await creatorAccount.createAccount(
        fullId,
        publicKey,
        initialBalance
      );

      const txHash = result.transaction.hash;
      const explorerUrl = isTestnet
        ? `https://testnet.nearblocks.io/txns/${txHash}`
        : `https://nearblocks.io/txns/${txHash}`;

      console.log('✅ NEAR account created successfully:', {
        accountId: fullId,
        publicKey,
        transaction: txHash,
        explorer: explorerUrl,
        network: networkId,
        cost: `${initialBalanceNear} NEAR`,
      });

      // Store private key in Shade TEE
      try {
        const shadeUrl = process.env.NEXT_PUBLIC_SHADE_API_URL!;
        
        // Get Auth0 access token from session
        const accessToken = session.accessToken;
        
        if (!accessToken) {
          throw new Error('No access token in session');
        }
        
        console.log('Storing private key in Shade TEE with verified JWT...');
        
        const shadeResponse = await fetch(`${shadeUrl}/api/user-keys/store`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
          },
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
          const errorText = await shadeResponse.text();
          console.error('Shade API error:', errorText);
          
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          
          throw new Error(errorData.error || `Shade storage failed: ${shadeResponse.status}`);
        }

        const shadeData = await shadeResponse.json();
        console.log('✅ Private key stored in Shade TEE:', {
          checksum: shadeData.checksum,
          accountId: fullId,
        });

      } catch (shadeError) {
        console.error('❌ CRITICAL: Failed to store private key in Shade:', shadeError);
        
        // CRITICAL ERROR: Account was created but key storage failed
        console.error('=====================================');
        console.error('EMERGENCY RECOVERY INFORMATION');
        console.error('=====================================');
        console.error('Account ID:', fullId);
        console.error('Email:', email);
        console.error('Public Key:', publicKey);
        console.error('Private Key:', privateKey);
        console.error('Transaction:', txHash);
        console.error('Network:', networkId);
        console.error('=====================================');
        
        // Return error to user with transaction hash for support
        return NextResponse.json({
          error: 'Account created successfully, but secure key storage failed. Please contact support immediately with this transaction hash.',
          accountId: fullId,
          transaction: txHash,
          explorerUrl,
          critical: true,
          supportMessage: 'Your account was created but we could not securely store your credentials. Our support team will help you recover access.',
        }, { status: 500 });
      }

      // Success! Return account info (no private key in response)
      return NextResponse.json({ 
        accountId: fullId, 
        publicKey,
        network: networkId,
        transaction: txHash,
        explorerUrl,
        initialBalance: `${initialBalanceNear} NEAR`,
        message: 'Account created successfully and secured in TEE',
      });

    } catch (createError) {
      console.error('❌ NEAR account creation failed:', createError);
      
      // Parse NEAR-specific errors
      if (createError instanceof Error) {
        const errorMsg = createError.message;
        
        if (errorMsg.includes('already exists') || errorMsg.includes('AlreadyExists')) {
          return NextResponse.json(
            { error: `Account ${fullId} already exists. Please choose a different username.` },
            { status: 400 }
          );
        }
        
        if (errorMsg.includes('insufficient') || errorMsg.includes('not enough balance')) {
          return NextResponse.json(
            { error: `Parent account ${creatorAccountId} has insufficient balance. Please contact support.` },
            { status: 500 }
          );
        }
        
        if (errorMsg.includes('InvalidAccountId')) {
          return NextResponse.json(
            { error: `Invalid account ID format: ${fullId}` },
            { status: 400 }
          );
        }
      }
      
      // Generic error
      throw createError;
    }

  } catch (error) {
    console.error('Create account error:', error);
    
    // Log full error for debugging
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
      });
    }
    
    return NextResponse.json({ 
      error: 'Failed to create account. Please try again or contact support.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}