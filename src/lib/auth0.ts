// src/lib/auth0.ts
import { initAuth0 } from '@auth0/nextjs-auth0';
import type { IncomingMessage, ServerResponse } from 'http';
import { headers, cookies } from 'next/headers';

// Minimal User interface (matches core types.ts; extend for customs like near_account_id)
export interface User {
  sub?: string;               // Auth0 user ID
  email?: string;             // Verified email
  email_verified?: boolean;   // Email confirmation
  name?: string;              // Display name
  picture?: string;           // Profile image
  given_name?: string;        // First name
  family_name?: string;       // Last name
  nickname?: string;          // Username
  locale?: string;            // Preferred language
  updated_at?: string;        // Last update timestamp

  // Custom claims (e.g., from Auth0 rules/actions)
  near_account_id?: string;  // Your relayer-generated NEAR ID
  [key: string]: unknown;    // Allow extras (unknown > any for type safety)
}

export const auth0 = initAuth0({
  secret: process.env.AUTH0_SECRET!,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL!,
  baseURL: process.env.AUTH0_BASE_URL!,
  clientID: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  authorizationParams: {
    audience: process.env.AUTH0_AUDIENCE || undefined,
    redirect_uri: `${process.env.AUTH0_BASE_URL}/api/auth/callback`,
    scope: 'openid profile email',
  },
});

export const {
  handleAuth,
  handleLogin,
  handleLogout,
  handleCallback,
  handleProfile,
  getSession,
} = auth0;

// Async server-safe getSession
export async function getServerSession() {
  try {
    const cookieStore = await cookies();  // Await v15 Promise
    const sessionCookie = cookieStore.get('auth0.session');
    if (!sessionCookie?.value) return null;

    // Await headers() Promise (v15 fix)
    const headerStore = await headers();
    const reqHeaders = Object.fromEntries(headerStore.entries());

    // Mock req: Use headers for full context
    const mockReq = {
      headers: {
        ...reqHeaders,
        cookie: sessionCookie.value,
      },
      url: '/',
      method: 'GET',
    } as unknown as IncomingMessage;

    // Define typed mock for headers to avoid 'any'
    type MockHeaders = Record<string, string | number | readonly string[] | undefined>;
    const mockHeaders: MockHeaders = {};

    // Mock res: Dummy with minimal stubs
    const mockRes = {
      statusCode: 200,
      statusMessage: 'OK',
      headers: mockHeaders,
      setHeader: (name: string, value: string | number | readonly string[]) => {
        mockHeaders[name] = value;
        return mockRes;
      },
      getHeader: (name: string) => mockHeaders[name],
      removeHeader: (name: string) => {
        delete mockHeaders[name];
      },
      writeHead: (statusCode: number, statusMessage?: string, headers?: Record<string, string | number | readonly string[]>) => {
        mockRes.statusCode = statusCode || 200;
        mockRes.statusMessage = statusMessage || 'OK';
        if (headers) Object.assign(mockHeaders, headers);
        return mockRes;
      },
      write: (_chunk?: string | Buffer | Uint8Array, _encoding?: string) => mockRes,
      end: (_chunk?: string | Buffer | Uint8Array, _encoding?: string, _callback?: () => void) => {
        if (_callback) _callback();
        return mockRes;
      },
      // Stub more if needed (e.g., addEventListener: () => {}, on: () => {})
    } as unknown as ServerResponse;

    // Call getSession with tuple
    const { getSession } = await import('@auth0/nextjs-auth0');
    return await getSession(mockReq, mockRes);
  } catch (error) {
    console.error('getServerSession error:', error);
    return null;
  }
}