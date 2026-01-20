// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let our custom profile route handle /auth/profile
  if (pathname === '/auth/profile') {
    return NextResponse.next();
  }
  
  // Let Auth0 handle its own routes (login, logout, callback)
  if (pathname.startsWith('/auth/')) {
    try {
      return await auth0.middleware(request);
    } catch (error) {
      console.error('Auth0 middleware error:', error);
      throw error;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.svg$).*)',
  ],
};