// src/app/api/auth/[...auth0]/route.ts
import { handleAuth, handleLogin, handleLogout, handleCallback } from '@/lib/auth0';
import { getServerSession } from '@/lib/auth0';  // Use server-safe async
import { NextRequest, NextResponse } from 'next/server';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { IncomingHttpHeaders } from 'http';
import type { Session } from '@auth0/nextjs-auth0';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auth0: string[] }> }
) {
  const resolvedParams = await params;  // Await v16 Promise
  const { auth0 } = resolvedParams;     // Now safe destructuring

  // Handle /api/auth/me (Auth0 sub-call)
  if (auth0[0] === 'me') {
    try {
      const session = await getServerSession();
      return NextResponse.json({ user: session?.user || null });
    } catch (error) {
      console.error(' /me session error:', error);
      return NextResponse.json({ error: 'Session unavailable' }, { status: 500 });
    }
  }

  // FIXED: Manual mockReq (no spread)—build with Auth0 needs (url, headers as IncomingHttpHeaders, method)
  const headersObj: IncomingHttpHeaders = Object.fromEntries(request.headers.entries());  // Convert Headers → plain object
  const mockReq: Partial<NextApiRequest> = {
    url: request.url,
    method: request.method,
    headers: headersObj,
    // Add if needed: body: await request.text(), query: Object.fromEntries(request.nextUrl.searchParams.entries())
  };
  const mockRes = { redirect: (url: string) => ({ url }) } as unknown as NextApiResponse;

  // Invoke with resolved params
  const authHandler = handleAuth({
    login: handleLogin({
      returnTo: '/',
    }),
    logout: handleLogout({
      returnTo: '/',
    }),
    callback: handleCallback({
      // FIXED: Remove unused 'res' param (now just req)
      afterCallback: async (req: NextApiRequest): Promise<Session | undefined> => {
        try {
          console.log('Callback starting...', req.url);
          console.log('Callback success – tokens exchanged');

          const session = await getServerSession();  // Use async wrapper
          if (!session?.user) {
            throw new Error('No session after callback');
          }

          const { email } = session.user;
          const idToken = session.id_token || '';  // Handle undefined

          // FIXED: No 'as any'—use optional chaining (User interface has near_account_id?: string)
          let nearAccountId = session.user.near_account_id;
          if (!nearAccountId) {
            const relayerResponse = await fetch(`${process.env.NEXT_PUBLIC_RELAYER_URL}/v1/account/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email,
                provider: 'auth0',
                token: idToken,
              }),
            });

            if (!relayerResponse.ok) {
              const errorText = await relayerResponse.text();
              throw new Error(`Relayer failed: ${relayerResponse.status} - ${errorText.slice(0, 100)}`);
            }

            const relayerData = await relayerResponse.json();
            nearAccountId = relayerData.account_id;
            if (!nearAccountId) {
              throw new Error('No account_id from relayer');
            }

            console.log(`Relayer created account: ${nearAccountId} for ${email}`);
          }

          const updatedUser = { ...session.user, near_account_id: nearAccountId };
          const updatedSession = { ...session, user: updatedUser } as Session;

          console.log(`Session updated with NEAR: ${nearAccountId}; redirecting to /`);

          return updatedSession;
        } catch (error) {
          console.error('Auth0 callback error:', error);
          return undefined;
        }
      },
    }),
  });

  // Call with mock (Auth0 expects Pages handler; returns Response-like)
  const response = authHandler(mockReq, mockRes);

  // Convert to NextResponse (handle redirect or JSON)
  if (typeof response === 'object' && 'url' in response) {
    return NextResponse.redirect(response.url as string);
  }
  return NextResponse.json(response || {}, { status: 200 });  // Fallback
}