# NOVA - Multi-User Interface
**https://nova-sdk.com**

This app is the official multi-user interface for NOVA, a privacy-first, decentralized file-sharing system built on NEAR Protocol, IPFS, and Phala/TEEs. It provides encrypted group-based storage with on-chain access control and off-chain key management that never exposes private keys.

### Key Features

- **Email-only onboarding** – Log in with Google, GitHub, or email. A real NEAR account (`username.nova-sdk.near` on mainnet) is created automatically in the background via FastAuth-style subaccount flow.
- **Zero seed phrases** – Private keys are generated client-side and immediately backed up encrypted inside a verified TEE (Shade Agent). On every future login the key is securely retrieved and injected –users never see or manage keys.
- **Full multi-user MCP interface** – Powered by FastMCP with Remote OAuth (Auth0). No shared secrets, no env-leaked keys.
- **Pay-per-action funding** – Small on-chain fees are paid automatically from your account (testnet free, mainnet via Stripe Onramp).
- **GDPR-ready** – Consent management, data export, and account deletion built in.

### Architecture Summary
User → Auth0 → nova-sdk.com (Next.js)
          ↓
   Shade TEE (stores encrypted private key)
          ↓
   NEAR account (username.nova-sdk-*.near)
          ↓
   FastMCP server (authenticated via Auth0 JWT)
          ↓
   NOVA smart contract + IPFS

All heavy cryptography and key storage happens inside attested TEEs. The MCP server and frontend never see private keys.

**Live on testnet**: https://nova-sdk.com  
Mainnet launch Q1 2026.

Built for the Agent Economy – your data, your vault, your rules.