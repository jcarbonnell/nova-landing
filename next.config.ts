// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@pingpay/onramp-sdk', '@pingpay/onramp-types'],
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_RELAYER_URL: process.env.NEXT_PUBLIC_RELAYER_URL,
    NEXT_PUBLIC_NEAR_NETWORK: process.env.NEXT_PUBLIC_NEAR_NETWORK,
  },
  
  async rewrites() {
    return [
      {
        source: '/api/mcp-proxy/:path*',
        destination: `${process.env.MCP_URL || 'https://nova-mcp.fastmcp.app'}/mcp/:path*`,
      },
    ];
  },
  
  async headers() {
    const csp = `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.auth0.com https://auth0.com;
      style-src 'self' 'unsafe-inline';
      connect-src 'self' https://*.auth0.com https://auth0.com https://*.near.org https://rpc.mainnet.near.org https://rpc.testnet.near.org https://*.nearblocks.io https://near-faucet.io https://relayer.mainnet.near.org https://relayer.testnet.near.org;
      img-src 'self' data: https: blob:;
      font-src 'self' https:;
      frame-src 'self' https://*.auth0.com https://walletselector.com https://crypto-js.stripe.com;
      worker-src 'self' blob:;
    `.replace(/\s{2,}/g, ' ').trim();

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;