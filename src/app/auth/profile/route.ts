// src/app/auth/profile/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function GET(req: NextRequest) {
  try {
    // Try to get Auth0 session
    const session = await auth0.getSession();
    
    if (session?.user) {
      // Auth0 user with valid session - return their profile
      // This is exactly what the default Auth0 route does
      return NextResponse.json(session.user);
    }
    
    // No Auth0 session - return 204 No Content
    // This tells useUser() "no user" without triggering error retry loops
    // 204 is a success status, so useUser() won't spam retries
    return new NextResponse(null, { status: 204 });
    
  } catch (error) {
    // On any error, return 204 to prevent retry spam
    console.error('Auth profile error:', error);
    return new NextResponse(null, { status: 204 });
  }
}