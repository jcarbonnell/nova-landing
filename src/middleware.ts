// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  // 1. Let Auth0 handle /auth/login, /auth/logout, /auth/callback automatically
  const authResponse = await auth0.middleware(request);

  // 2. If Auth0 processed it (returns a response), use it
  if (authResponse) {
    return authResponse;
  }

  // 3. Otherwise fall through to normal page rendering
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};