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
    scope: 'openid profile email offline_access read:keys write:keys check:keys',
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

// Get access token with correct audience for Shade TEE
// The access token has the right audience (https://nova-mcp.fastmcp.app)
// We need to ensure it ALSO contains user claims (email/sub) via Auth0 API settings
export async function getAuthToken(): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    
    if (!session) {
      console.warn('❌ No session found');
      return null;
    }
    
    // STRATEGY 1: Use accessToken (has correct audience for Shade)
    if (session.tokenSet?.accessToken) {
      console.log('✅ Using accessToken with audience: https://nova-mcp.fastmcp.app');
      return session.tokenSet.accessToken;
    }
    
    // STRATEGY 2: Try to get fresh access token using getAccessToken helper
    console.log('🔄 Attempting to get fresh access token...');
    try {
      const { token } = await auth0.getAccessToken();
      if (token) {
        console.log('✅ Got fresh accessToken');
        return token;
      }
    } catch (refreshError) {
      console.error('❌ getAccessToken failed:', refreshError);
    }
    
    // STRATEGY 3: Fallback to idToken (wrong audience but has user claims)
    if (session.tokenSet?.idToken) {
      console.warn('⚠️ Falling back to idToken (may have wrong audience)');
      return session.tokenSet.idToken;
    }
    
    console.error('❌ No valid tokens available in session');
    return null;
    
  } catch (error: unknown) {
    console.error('❌ getAuthToken error:', error);
    return null;
  }
}

// Helper to get specifically the ID token (for user identity)
export async function getIdToken(): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    
    if (!session?.tokenSet?.idToken) {
      console.warn('❌ No idToken in session');
      return null;
    }
    
    console.log('✅ Retrieved idToken');
    return session.tokenSet.idToken;
  } catch (error: unknown) {
    console.error('❌ getIdToken error:', error);
    return null;
  }
}

// Helper to get specifically the access token (for API calls)
export async function getAccessToken(): Promise<string | null> {
  try {
    const { token } = await auth0.getAccessToken();
    
    if (!token) {
      console.warn('❌ No accessToken available');
      return null;
    }
    
    console.log('✅ Retrieved accessToken');
    return token;
  } catch (error: unknown) {
    console.error('❌ getAccessToken error:', error);
    return null;
  }
}