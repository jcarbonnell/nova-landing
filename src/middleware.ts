// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';  // Adjust path if needed (e.g., '../lib/auth0')

export async function middleware(request: NextRequest) {
  // Delegate to Auth0 middleware first (handles /auth/* routes)
  const response = await auth0.middleware(request);

  // Public paths (expanded for auth flows; post-Auth0 check)
  const publicPaths = ['/_next/static', '/_next/image', '/favicon.ico', '/'];
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
  `.replace(/\s{2,}/g, ' ').trim();

  // Always start with response for clean cloning
  let finalResponse = response || NextResponse.next();

  if (!isPublicPath) {
    // Basic cookie check (edge-safe; no getSession import—Auth0 middleware already verified)
    const sessionCookie = request.cookies.get('auth0.session');
    if (!sessionCookie?.value) {
      const loginUrl = new URL('/auth/login', request.url);  // v4 path: /auth/login
      loginUrl.searchParams.set('returnTo', encodeURI(request.nextUrl.pathname));
      return NextResponse.redirect(loginUrl);
    }
    // Forward if cookie exists (full verify via useUser in pages)
  }

  // Attach CSP to all non-redirect responses (applies to public + protected-with-cookie)
  // finalResponse.headers.set('Content-Security-Policy', csp);  // Uncomment if needed
  finalResponse.headers.set('X-Content-Type-Options', 'nosniff');  // Bonus: Extra security header
  finalResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');  // Prevent clickjacking

  return finalResponse;
}

export const config = {
  matcher: [
    // Skip auth pages/static/assets (CSP still applies where cloned)
    '/((?!auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};