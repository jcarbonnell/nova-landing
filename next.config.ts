/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_RELAYER_URL: process.env.NEXT_PUBLIC_RELAYER_URL,
  },
  // New: Proxy config replaces middleware
  async rewrites() {
    return [
      // Proxy MCP (your /api/mcp-proxy → MCP URL)
      {
        source: '/api/mcp-proxy/:path*',
        destination: `${process.env.MCP_URL || 'https://nova-mcp.fastmcp.app'}/mcp/:path*`,
      },
      // Auth redirects (protect non-public)
      {
        source: '/api/auth/:path*',
        destination: '/api/auth/:path*',  // Passthrough
      },
      // Static/public passthrough
      {
        source: '/_next/static/:path*',
        destination: '/_next/static/:path*',
      },
      {
        source: '/_next/image/:path*',
        destination: '/_next/image/:path*',
      },
      {
        source: '/favicon.ico',
        destination: '/favicon.ico',
      },
      // Catch-all: Redirect unauth to login (simulate middleware check)
      {
        source: '/:path*',
        destination: '/:path*',  // Default passthrough; add logic in pages if needed
      },
    ];
  },
  // CSP via headers (move from middleware)
  async headers() {
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

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;