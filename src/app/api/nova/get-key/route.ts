// src/app/api/nova/get-key/route.ts
import { NextRequest, NextResponse } from 'next/server';

const SHADE_API_URL = process.env.NEXT_PUBLIC_SHADE_API_URL;

if (!SHADE_API_URL) {
  console.error('NEXT_PUBLIC_SHADE_API_URL is not configured');
}

export async function POST(req: NextRequest) {
  const accountId = req.headers.get('x-account-id');
  const walletId = req.headers.get('x-wallet-id');
  const userEmail = req.headers.get('x-user-email');

  if (!accountId) {
    return NextResponse.json({ error: 'Missing account ID' }, { status: 400 });
  }

  if (!SHADE_API_URL) {
    return NextResponse.json({ error: 'Shade API URL not configured' }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { group_id } = body;

  if (!group_id) {
    return NextResponse.json({ error: 'group_id required' }, { status: 400 });
  }

  console.log('get-key request:', { 
    accountId, 
    group_id, 
    hasWalletId: !!walletId,
    hasEmail: !!userEmail 
  });

  try {
    // Call Shade key-management API directly
    // Using account_id auth (same as server.py when payload_b64/sig_hex are "auto")
    const shadeResponse = await fetch(`${SHADE_API_URL}/api/key-management/get_key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id,
        account_id: accountId,
      }),
    });

    if (!shadeResponse.ok) {
      const errorText = await shadeResponse.text();
      console.error('Shade get_key failed:', {
        status: shadeResponse.status,
        error: errorText.substring(0, 200),
        group_id,
        accountId,
      });

      // Map common Shade errors to user-friendly messages
      if (shadeResponse.status === 404) {
        return NextResponse.json({ 
          error: 'Group key not found. The group may not exist or you may not have access.' 
        }, { status: 404 });
      }
      if (shadeResponse.status === 403) {
        return NextResponse.json({ 
          error: 'Access denied. You are not authorized for this group.' 
        }, { status: 403 });
      }

      return NextResponse.json({ 
        error: 'Failed to retrieve encryption key from Shade TEE' 
      }, { status: shadeResponse.status });
    }

    const shadeData = await shadeResponse.json();

    const key = shadeData.key;
    const checksum = shadeData.checksum;

    if (!key || !checksum) {
      console.error('Invalid Shade response: missing key or checksum', { 
        hasKey: !!key, 
        hasChecksum: !!checksum 
      });
      return NextResponse.json({ 
        error: 'Invalid response from Shade TEE: missing key data' 
      }, { status: 500 });
    }

    console.log('Retrieved encryption key for:', { group_id, accountId, checksum });

    return NextResponse.json({ key, checksum });
  } catch (error) {
    console.error('get-key error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}