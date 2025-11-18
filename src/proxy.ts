// proxy.ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';  // Adjust path if root file

export async function proxy(request: NextRequest) {  // Changed: middleware() → proxy()
  // DEBUG: Log every time proxy runs (especially /auth/callback)
  console.log('Proxy triggered:', {
    url: request.url,
    method: request.method,
    pathname: request.nextUrl.pathname,
    hasAuth0Secret: !!process.env.AUTH0_SECRET,
    auth0SecretLength: process.env.AUTH0_SECRET?.length ?? 0,
    appBaseUrl: process.env.APP_BASE_URL,
  });

  try {
    const response = await auth0.middleware(request);  // Note: Still call .middleware() inside

    if (response) {
      console.log('Auth0 handled request → returning response', {
        status: response.status,
        redirect: response.headers.get('location'),
      });
      return response;
    }

    // Auth0 did not handle it → normal page
    return NextResponse.next();
  } catch (error: any) {
    console.error('Auth0 proxy threw error:', {
      message: error?.message,
      name: error?.name,
      stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
      url: request.url,
    });
    return NextResponse.redirect(new URL('/', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};