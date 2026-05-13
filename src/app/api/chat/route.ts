// src/app/api/chat/route.ts
import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK || 'mainnet';
const ACCOUNT_SUFFIX = NETWORK_ID === 'mainnet' ? '.nova-sdk.near' : '.nova-sdk-6.testnet';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages } = body;
    
    const accountId = req.headers.get('x-account-id');
    const walletId = req.headers.get('x-wallet-id');

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!accountId) {
      return new Response(JSON.stringify({ error: 'Missing account ID' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let userEmail: string | undefined;
    let accessToken: string | undefined;

    if (walletId) {
      console.log('Wallet user detected');
    } else {
      const session = await auth0.getSession();
      if (!session?.user?.email) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      userEmail = session.user.email;
      accessToken = session.tokenSet?.accessToken;
    }

    // Build headers for MCP REST calls
    const toolHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-account-id': accountId,
    };

    if (walletId) {
      toolHeaders['Authorization'] = `Bearer wallet:${walletId}`;
      toolHeaders['x-wallet-id'] = walletId;
    } else if (accessToken) {
      toolHeaders['Authorization'] = `Bearer ${accessToken}`;
      if (userEmail) {
        toolHeaders['x-user-email'] = userEmail;
      }
    }

    // Helper to call MCP REST endpoints
    async function callMCPTool(toolName: string, args: Record<string, unknown>) {
      const response = await fetch(`${MCP_URL}/tools/${toolName}`, {
        method: 'POST',
        headers: toolHeaders,
        body: JSON.stringify(args)
      });
      if (!response.ok) {
        throw new Error(`Tool ${toolName} failed: ${response.statusText}`);
      }
      const result = await response.json();
      return result.result || result;
    }

    const userIdentifier = walletId || userEmail;
    const systemPrompt = `You are NOVA, a secure file-sharing assistant powered by the NOVA SDK.

Your capabilities include:
- Uploading files with end-to-end encryption (use composite_upload tool)
- Creating secure sharing groups
- Managing access permissions
- Tracking file analytics
- Retrieving shared files

Current user: ${userIdentifier}
NEAR Account: ${accountId || 'Not connected'}
Network: ${NETWORK_ID}

═══════════════════════════════════════════════════════════════════════════════

IMPORTANT - ACCOUNT ID HANDLING:
When users mention account names for member management, AUTOMATICALLY append 
the NOVA suffix "${ACCOUNT_SUFFIX}" if the name doesn't already contain a dot.

RULES:
1. "john" → "john${ACCOUNT_SUFFIX}" (auto-complete)
2. "alice" → "alice${ACCOUNT_SUFFIX}" (auto-complete)
3. "bob.near" → "bob.near" (keep as-is, external account)
4. "carol.testnet" → "carol.testnet" (keep as-is, external account)
5. "dave${ACCOUNT_SUFFIX}" → "dave${ACCOUNT_SUFFIX}" (already complete)

EXAMPLES:
- User: "Add john to my-team" 
  → Call add_group_member with member_id="john${ACCOUNT_SUFFIX}"
  
- User: "Remove alice from project-x"
  → Call revoke_group_member with member_id="alice${ACCOUNT_SUFFIX}"
  
- User: "Add bob.near to my-team"
  → Call add_group_member with member_id="bob.near" (external account)

NEVER ask the user to provide the full account ID with suffix.
ALWAYS auto-complete usernames silently and confirm the action with the full ID.
ONLY ask for clarification if the username is ambiguous or invalid or the auto-completion results in an error.

═══════════════════════════════════════════════════════════════════════════════
IMPORTANT - QUERYING USER DATA:
You have tools to query the user's groups, members, and files directly from the blockchain.
ALWAYS use these tools when the user asks about their data - never say you "can't access" this information.

AVAILABLE QUERY TOOLS:
1. get_owned_groups - Returns groups the user OWNS (created)
   → Use when: "What groups do I own?", "Show my groups", "List groups I created"
   
2. get_member_groups - Returns ALL groups the user is a MEMBER of (includes owned)
   → Use when: "What groups am I in?", "Which groups can I access?", "My memberships"
   
3. get_group_members - Returns members of a specific group (requires group_id)
   → Use when: "Who's in [group]?", "List members of [group]", "Who has access to [group]?"
   
4. get_group_transactions - Returns files/transactions in a group (requires group_id)
   → Use when: "What files are in [group]?", "Show uploads in [group]", "List shared files"

QUERY EXAMPLES:
- User: "What groups do I own?"
  → Call get_owned_groups, then list the results

- User: "Who has access to my-team?"
  → Call get_group_members with group_id="my-team"

- User: "What files are shared in project-x?"
  → Call get_group_transactions with group_id="project-x"

- User: "Show me everything about my-team"
  → Call get_group_members AND get_group_transactions for complete info

- User: "What groups can I access?"
  → Call get_member_groups (this includes both owned and member groups)

IMPORTANT: These queries cost a small fee (0.0001 NEAR each). The fee is paid automatically.
If a query fails with "Unauthorized", the user is not a member of that group.

═══════════════════════════════════════════════════════════════════════════════

IMPORTANT - FILE OPERATIONS:

UPLOAD FILES:
When a user wants to upload a file:
1. Ask which group if not specified
2. Call prepare_upload(group_id, filename) - this returns a key and upload_id
3. The frontend will automatically encrypt the file and complete the upload
4. Wait for the frontend to report success/failure

RETRIEVE/DOWNLOAD FILES:
When a user wants to download a file:
1. If they don't have the CID, use get_group_transactions to find it
2. Call prepare_retrieve(group_id, ipfs_hash) - this returns the key and encrypted data
3. The frontend will automatically decrypt and download the file

Available tools for files:
- prepare_upload: Start an upload (returns key for encryption)
- finalize_upload: Complete an upload (frontend calls this after encrypting)
- prepare_retrieve: Get encrypted file + key (frontend decrypts locally)
- get_group_transactions: List files in a group

═══════════════════════════════════════════════════════════════════════════════

IMPORTANT - GROUP & MEMBER MANAGEMENT:
When users want to manage groups or members, use the following tools:
- get_owned_groups: List groups the user owns
- get_member_groups: List all groups the user is a member of
- get_group_members: List members of a specific group
- get_group_transactions: List files in a specific group

For group management:
   - register_group: Create a new group (caller becomes owner)
   - add_group_member: Add member to a group
   - revoke_group_member: Remove member (key rotation happens automatically)

═══════════════════════════════════════════════════════════════════════════════

RESPONSE STYLE:
- Be concise and helpful
- When showing lists (groups, members, files), format them clearly
- Always confirm successful operations with relevant details
- If an operation fails, explain why and suggest fixes
- For file transactions, show: filename, IPFS hash (CID), and file hash when available

Be helpful, concise, and security-conscious.`;

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: {
        // ─── Query tools ───
        get_owned_groups: tool({
          description: 'List all groups owned by the current user',
          inputSchema: z.object({}),
          execute: async () => callMCPTool('get_owned_groups', {}),
        }),
        get_member_groups: tool({
          description: 'List all groups the user is a member of (includes owned groups)',
          inputSchema: z.object({}),
          execute: async () => callMCPTool('get_member_groups', {}),
        }),
        get_group_members: tool({
          description: 'List all members of a specific group',
          inputSchema: z.object({
            group_id: z.string().describe('The group identifier'),
          }),
          execute: async ({ group_id }) => callMCPTool('get_group_members', { group_id }),
        }),
        get_group_transactions: tool({
          description: 'List all files/transactions in a specific group',
          inputSchema: z.object({
            group_id: z.string().describe('The group identifier'),
          }),
          execute: async ({ group_id }) => callMCPTool('get_group_transactions', { group_id }),
        }),

        // ─── Group management ───
        register_group: tool({
          description: 'Create a new group for secure file sharing. The caller becomes the owner.',
          inputSchema: z.object({
            group_id: z.string().describe('Unique group identifier (e.g., "my-team")'),
          }),
          execute: async ({ group_id }) => callMCPTool('register_group', { group_id }),
        }),
        add_group_member: tool({
          description: 'Add a member to a group (owner only)',
          inputSchema: z.object({
            group_id: z.string().describe('The group identifier'),
            member_id: z.string().describe('NEAR account ID of the member to add'),
          }),
          execute: async ({ group_id, member_id }) =>
            callMCPTool('add_group_member', { group_id, member_id }),
        }),
        revoke_group_member: tool({
          description: 'Remove a member from a group (owner only, automatically rotates encryption key)',
          inputSchema: z.object({
            group_id: z.string().describe('The group identifier'),
            member_id: z.string().describe('NEAR account ID of the member to remove'),
          }),
          execute: async ({ group_id, member_id }) =>
            callMCPTool('revoke_group_member', { group_id, member_id }),
        }),

        // ─── File operations ───
        prepare_upload: tool({
          description: 'Start an upload - returns encryption key and upload_id. Frontend handles encryption.',
          inputSchema: z.object({
            group_id: z.string().describe('The group to upload to'),
            filename: z.string().describe('Name of the file being uploaded'),
          }),
          execute: async ({ group_id, filename }) =>
            callMCPTool('prepare_upload', { group_id, filename }),
        }),
        finalize_upload: tool({
          description: 'Complete an upload after encryption. Records transaction on blockchain.',
          inputSchema: z.object({
            group_id: z.string(),
            upload_id: z.string(),
            ipfs_hash: z.string().describe('IPFS CID of the encrypted file'),
            filename: z.string(),
            file_hash: z.string().optional().describe('SHA-256 hash of original file'),
          }),
          execute: async (args) => callMCPTool('finalize_upload', args),
        }),
        prepare_retrieve: tool({
          description: 'Get encryption key and encrypted file data for download. Frontend handles decryption.',
          inputSchema: z.object({
            group_id: z.string().describe('The group containing the file'),
            ipfs_hash: z.string().describe('IPFS CID of the file to retrieve'),
          }),
          execute: async ({ group_id, ipfs_hash }) =>
            callMCPTool('prepare_retrieve', { group_id, ipfs_hash }),
        }),
      },
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse();

  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Chat processing failed', 
        details: error instanceof Error ? error.message : 'Unknown error',
      }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}