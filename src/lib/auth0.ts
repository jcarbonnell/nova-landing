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

const SHADE_AUDIENCE = 'https://nova-mcp.fastmcp.app';

// v4: Instantiate client with explicit config to ensure all vars are read
export const auth0 = new Auth0Client({
  appBaseUrl: process.env.APP_BASE_URL!,
  secret: process.env.AUTH0_SECRET!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  domain: process.env.AUTH0_DOMAIN!,
  authorizationParameters: {
    scope: 'openid profile email offline_access',
    audience: process.env.AUTH0_AUDIENCE || SHADE_AUDIENCE,
    response_type: 'code',
    response_mode: 'query',
  },
  session: {
    rolling: true,
    inactivityDuration: 86400, // 24 hours
    absoluteDuration: 604800, // 7 days
  },
});

// Wrapper for getSession to use anywhere idToken is needed
export async function getServerSession() {
  try {
    const session = await auth0.getSession();
    
    if (!session) return null;
    
    // In v4, tokens are in session.tokenSet
    // Create a flattened version for easier access
    return {
      ...session,
      idToken: session.tokenSet?.idToken,
      accessToken: session.tokenSet?.accessToken,
      refreshToken: session.tokenSet?.refreshToken,
    };
  } catch (error: unknown) {
    console.error('getServerSession error:', error);
    return null;
  }
}

// Helper to get token with fallback strategies
export async function getAuthToken(): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    
    if (!session) {
      console.warn('No session found');
      return null;
    }
    
    // Strategy 1: Try idToken first (preferred for authentication)
    if (session.tokenSet?.accessToken) {
      console.log('✅ Using idToken from tokenSet');
      return session.tokenSet.accessToken;
    }
    
    // Strategy 2: Fallback to accessToken
    if (session.tokenSet?.idToken) {
      console.log('⚠️ idToken missing, falling back to accessToken');
      return session.tokenSet.idToken;
    }
    
    // Strategy 3: Try to refresh tokens if refresh token exists
    if (session.tokenSet?.refreshToken) {
      console.log('🔄 Attempting token refresh...');
      try {
        // Use getAccessToken which automatically refreshes
        const { token } = await auth0.getAccessToken();
        if (token) {
          console.log('✅ Token refreshed successfully');
          return token;
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
      }
    }
    
    console.error('❌ No valid tokens available in session');
    return null;
    
  } catch (error: unknown) {
    console.error('getAuthToken error:', error);
    return null;
  }
}