import { NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/auth0';

export async function GET() {
  try {
    const token = await getAuthToken();
    
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    return NextResponse.json({ 
      access_token: token,
      note: 'Delete this endpoint after testing!'
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}