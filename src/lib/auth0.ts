// src/lib/auth0.ts
import { Auth0Client } from '@auth0/nextjs-auth0/server';

// Minimal User interface
export interface User {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  locale?: string;
  updated_at?: string;
  near_account_id?: string;
  [key: string]: unknown;
}

// v4: Instantiate client (reads env auto—no config obj needed)
export const auth0 = new Auth0Client({
  appBaseUrl: process.env.APP_BASE_URL,
  authorizationParameters: {
    scope: 'openid profile email offline_access',
    audience: process.env.AUTH0_AUDIENCE, 
  },
});

// Named export: Wrapper for getSession (v4 method, no mocks/req/res)
export async function getServerSession() {
  try {
    return await auth0.getSession();
  } catch (error: unknown) {
    console.error('getServerSession error:', error);
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return null;
  }
}