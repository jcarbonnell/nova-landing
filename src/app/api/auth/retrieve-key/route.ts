// src/app/api/auth/retrieve-key/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0, getShadeToken } from '@/lib/auth0';

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email } = await req.json();
  if (session.user.email !== email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = await getShadeToken();

  if (!token) {
    console.error('❌ No auth token available for key retrieval');
    return NextResponse.json({ 
      error: 'No authentication token available',
      details: 'Session exists but token is missing'
    }, { status: 401 });
  }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SHADE_API_URL}/api/user-keys/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, auth_token: token }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Shade retrieve failed:', {
        status: res.status,
        error: errorText.substring(0, 200),
      });
      throw new Error('Shade retrieve failed');
    }

    const data = await res.json();
    console.log('✅ Key retrieved from Shade TEE for:', email);

    return NextResponse.json({ private_key: data.private_key });
  } catch (err) {
    console.error('❌ Retrieve key error:', err);
    return NextResponse.json({ 
      error: 'Failed to retrieve key',
      details: err instanceof Error ? err.message : 'Unknown error'
    }, { status: 500 });
  }
}