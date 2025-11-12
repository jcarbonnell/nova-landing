// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Public paths (expanded for auth flows)
  const publicPaths = ['/api/auth', '/api/auth/*', '/_next/static', '/_next/image', '/favicon.ico', '/'];
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path));
  if (isPublicPath) {
    return NextResponse.next();
  }

  // Basic cookie check (edge-safe; no getSession import)
  const sessionCookie = request.cookies.get('auth0.session');  // Auth0 sets this on login
  if (!sessionCookie?.value) {
    const loginUrl = new URL('/api/auth/login', request.url);
    loginUrl.searchParams.set('returnTo', encodeURI(request.nextUrl.pathname));
    return NextResponse.redirect(loginUrl);
  }

  // Forward if cookie exists (full verify in page)
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip auth pages/static/assets
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};