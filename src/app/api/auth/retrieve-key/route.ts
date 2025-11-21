// src/app/api/auth/retrieve-key/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email } = await req.json();
  if (session.user.email !== email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const token = session.idToken ?? session.accessToken;
  if (!token) {
    return NextResponse.json({ error: 'No token' }, { status: 401 });
  }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SHADE_API_URL}/api/user-keys/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, auth_token: token }),
    });

    if (!res.ok) throw new Error('Shade retrieve failed');

    const data = await res.json();
    return NextResponse.json({ private_key: data.private_key });
  } catch (err) {
    console.error('Retrieve key error:', err);
    return NextResponse.json({ error: 'Failed to retrieve key' }, { status: 500 });
  }
}