// src/app/api/debug-token/route.ts
import { auth0 } from '@/lib/auth0';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const session = await auth0.getSession();
    
    if (!session) {
      return NextResponse.json({ error: 'No session - please log in first' }, { status: 401 });
    }
    
    const accessToken = session.tokenSet?.accessToken;
    const idToken = session.tokenSet?.idToken;
    
    // Decode tokens to see claims (without verification)
    const decodeToken = (token: string | undefined) => {
      if (!token) return null;
      try {
        const parts = token.split('.');
        if (parts.length !== 3) return { error: 'Invalid JWT format' };
        return JSON.parse(Buffer.from(parts[1], 'base64').toString());
      } catch (e) {
        return { error: String(e) };
      }
    };
    
    const accessClaims = decodeToken(accessToken);
    const idClaims = decodeToken(idToken);
    
    return NextResponse.json({
      // Token presence
      hasAccessToken: !!accessToken,
      hasIdToken: !!idToken,
      
      // Decoded claims (the important part!)
      accessTokenClaims: accessClaims,
      idTokenClaims: idClaims,
      
      // Key fields for debugging
      debug: {
        accessToken_aud: accessClaims?.aud,
        accessToken_iss: accessClaims?.iss,
        accessToken_sub: accessClaims?.sub,
        accessToken_exp: accessClaims?.exp,
        accessToken_exp_human: accessClaims?.exp ? new Date(accessClaims.exp * 1000).toISOString() : null,
        idToken_email: idClaims?.email,
      },
      
      // Raw token for curl testing
      rawAccessToken: accessToken,
      rawIdToken: idToken,
    });
  } catch (error) {
    return NextResponse.json({ 
      error: 'Failed to get session',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}