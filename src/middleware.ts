// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function middleware(request: NextRequest) {
  console.log('middleware.ts RUNNING — DEBUG:', {
    url: request.url,
    path: request.nextUrl.pathname,
    hasSecret: !!process.env.AUTH0_SECRET,
    secretLength: process.env.AUTH0_SECRET?.length ?? 0,
    appBaseUrl: process.env.APP_BASE_URL,
  });

  try {
    const response = await auth0.middleware(request);

    if (response) {
      console.log('Auth0 SUCCESS →', {
        status: response.status,
        location: response.headers.get('location'),
      });
      return response;
    }

    return NextResponse.next();
  } catch (error: any) {
    console.error('Auth0 ERROR (this is the real one):', {
      message: error.message,
      name: error.name,
      code: error.code,
      url: request.url,
    });
    return new NextResponse('An error occurred while trying to exchange the authorization code.', {
      status: 500,
    });
  }
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};