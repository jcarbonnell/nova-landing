// nova-landing/src/lib/server-config.ts
//
// §5.12 item 10 — the ONE place server routes read where NOVA lives and which
// audiences its tokens carry. Server-only by use: nothing here is NEXT_PUBLIC_,
// and no client component may import it.
//
// RULES:
//   - No defaults, ever. A missing value fails the request with a named error;
//     it never falls back to a retired CVM (the old code fell back to the
//     first CVM's URL, which would have kept pointing there after the switch).
//   - Getters, not constants: read at request time, so `next build` does not
//     need runtime values and a missing value fails the request that needs it.
//   - Base URLs are normalised to an origin (no trailing slash, no path), so
//     `${mcpUrl()}/tools/x` is always well-formed.
//   - Audiences are compared byte-for-byte by every verifier (jose, jsonwebtoken,
//     PyJWT), so they are returned exactly as configured, and a trailing slash
//     (the classic one-character mismatch) is refused.
//   - Since §5.12 the audiences are stable names, not CVM URLs:
//       AUTH0_AUDIENCE         = https://nova-sdk.com/api/shade
//       SESSION_TOKEN_AUDIENCE = https://nova-sdk.com/api/mcp
//     so a CVM migration changes MCP_URL / SHADE_API_URL only.

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') throw new ConfigError(`${name} is not configured`);
  if (v !== v.trim()) throw new ConfigError(`${name} has leading or trailing whitespace`);
  return v;
}

function parseHttps(name: string, v: string): URL {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ConfigError(`${name} is not a URL`);
  }
  if (u.protocol !== 'https:') throw new ConfigError(`${name} must use https`);
  if (u.username || u.password) throw new ConfigError(`${name} must not carry credentials`);
  if (u.search || u.hash) throw new ConfigError(`${name} must not carry a query or fragment`);
  return u;
}

/** A service base URL: https, origin only. Returned without a trailing slash. */
function origin(name: string): string {
  const u = parseHttps(name, required(name));
  if (u.pathname !== '/') throw new ConfigError(`${name} must be an origin only (no path)`);
  return u.origin;
}

/** A token audience: https, no trailing slash, returned exactly as configured. */
function audience(name: string): string {
  const v = required(name);
  parseHttps(name, v);
  if (v.endsWith('/')) throw new ConfigError(`${name} must not end with '/'`);
  return v;
}

/** NOVA MCP (the `-8000` service on the CVM). */
export const mcpUrl = (): string => origin('MCP_URL');

/** NOVA Shade agent (the `-3000` service on the CVM). */
export const shadeApiUrl = (): string => origin('SHADE_API_URL');

/** Audience of the Auth0 access token sent to Shade (the Auth0 API identifier). */
export const auth0Audience = (): string => audience('AUTH0_AUDIENCE');

/** Audience of every nova_session token (consumed by MCP; verified by Shade too). */
export const sessionAudience = (): string => audience('SESSION_TOKEN_AUDIENCE');
