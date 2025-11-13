// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Public paths (expanded for auth flows)
  const publicPaths = ['/api/auth', '/api/auth/*', '/_next/static', '/_next/image', '/favicon.ico', '/'];
  const isPublicPath = publicPaths.some(path => request.nextUrl.pathname.startsWith(path));

  // Define minimal CSP (adjust domains as needed; e.g., add your Auth0 domain to connect-src)
  // Note: frame-src includes walletselector.com for modal iframes
  const csp = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.auth0.com https://auth0.com;
    style-src 'self' 'unsafe-inline';
    connect-src 'self' https://*.auth0.com https://auth0.com https://*.near.org https://rpc.testnet.near.org https://*.nearblocks.io;
    img-src 'self' data: https: blob:;
    font-src 'self' https:;
    frame-src 'self' https://*.auth0.com https://walletselector.com;
    worker-src 'self' blob:;
  `.replace(/\s{2,}/g, ' ').trim();  // Clean up whitespace

  // Always start with next() for clean response cloning
  let response = NextResponse.next();

  if (!isPublicPath) {
    // Basic cookie check (edge-safe; no getSession import)
    const sessionCookie = request.cookies.get('auth0.session');  // Auth0 sets this on login
    if (!sessionCookie?.value) {
      const loginUrl = new URL('/api/auth/login', request.url);
      loginUrl.searchParams.set('returnTo', encodeURI(request.nextUrl.pathname));
      return NextResponse.redirect(loginUrl);
    }
    // Forward if cookie exists (full verify in page)
  }

  // Attach CSP to all non-redirect responses (applies to public + protected-with-cookie)
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');  // Bonus: Extra security header
  response.headers.set('X-Frame-Options', 'DENY');  // Prevent clickjacking

  return response;
}

export const config = {
  matcher: [
    // Skip auth pages/static/assets (CSP still applies where cloned)
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};