import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK || 'mainnet';
const ACCOUNT_SUFFIX = NETWORK_ID === 'mainnet' ? '.nova-sdk.near' : '.nova-sdk-6.testnet';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages }: { messages: UIMessage[] } = body;
    
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

    // Get auth
    let accessToken: string | undefined;
    let userEmail: string | undefined;

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
      accessToken = session.tokenSet?.accessToken;
      userEmail = session.user.email;
    }

    // Build headers for REST calls
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

    // Define tools that call REST endpoints (like SDK does)
    async function callMCPTool(toolName: string, args: any) {
      console.log(`Calling tool: ${toolName}`, args);
      const response = await fetch(`${MCP_URL}/tools/${toolName}`, {
        method: 'POST',
        headers: toolHeaders,
        body: JSON.stringify(args)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tool ${toolName} failed: ${errorText}`);
      }

      const result = await response.json();
      return result.result || result;
    }

    const tools = {
      register_group: {
        description: 'Create a new group for secure file sharing',
        parameters: z.object({
          group_id: z.string().describe('Unique group identifier'),
        }),
        execute: async ({ group_id }: { group_id: string }) => {
          return await callMCPTool('register_group', { group_id });
        },
      },
      
      add_group_member: {
        description: 'Add a member to a group',
        parameters: z.object({
          group_id: z.string().describe('Group identifier'),
          member_id: z.string().describe('Member account ID to add'),
        }),
        execute: async ({ group_id, member_id }: { group_id: string; member_id: string }) => {
          return await callMCPTool('add_group_member', { group_id, member_id });
        },
      },

      revoke_group_member: {
        description: 'Remove a member from a group',
        parameters: z.object({
          group_id: z.string().describe('Group identifier'),
          member_id: z.string().describe('Member account ID to remove'),
        }),
        execute: async ({ group_id, member_id }: { group_id: string; member_id: string }) => {
          return await callMCPTool('revoke_group_member', { group_id, member_id });
        },
      },

      get_owned_groups: {
        description: 'List all groups owned by the current user',
        parameters: z.object({}),
        execute: async () => {
          return await callMCPTool('get_owned_groups', {});
        },
      },

      get_member_groups: {
        description: 'List all groups the current user is a member of',
        parameters: z.object({}),
        execute: async () => {
          return await callMCPTool('get_member_groups', {});
        },
      },

      get_group_members: {
        description: 'List members of a specific group',
        parameters: z.object({
          group_id: z.string().describe('Group ID to query'),
        }),
        execute: async ({ group_id }: { group_id: string }) => {
          return await callMCPTool('get_group_members', { group_id });
        },
      },

      get_group_transactions: {
        description: 'List file transactions in a group',
        parameters: z.object({
          group_id: z.string().describe('Group ID to query'),
        }),
        execute: async ({ group_id }: { group_id: string }) => {
          return await callMCPTool('get_group_transactions', { group_id });
        },
      },

      prepare_upload: {
        description: 'Prepare file upload - returns encryption key',
        parameters: z.object({
          group_id: z.string().describe('Group to upload to'),
          filename: z.string().describe('Name of file to upload'),
        }),
        execute: async ({ group_id, filename }: { group_id: string; filename: string }) => {
          return await callMCPTool('prepare_upload', { group_id, filename });
        },
      },

      prepare_retrieve: {
        description: 'Prepare file retrieval - returns decryption key',
        parameters: z.object({
          group_id: z.string().describe('Group containing the file'),
          ipfs_hash: z.string().describe('IPFS CID of the file'),
        }),
        execute: async ({ group_id, ipfs_hash }: { group_id: string; ipfs_hash: string }) => {
          return await callMCPTool('prepare_retrieve', { group_id, ipfs_hash });
        },
      },

      auth_status: {
        description: 'Check authentication status',
        parameters: z.object({
          group_id: z.string().optional().describe('Optional group ID'),
        }),
        execute: async ({ group_id }: { group_id?: string }) => {
          return await callMCPTool('auth_status', group_id ? { group_id } : {});
        },
      },
    };

    const modelMessages = convertToModelMessages(messages);
    const userIdentifier = walletId || userEmail;

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: `You are NOVA, a secure file-sharing assistant powered by the NOVA SDK.

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

Be helpful, concise, and security-conscious.`,
      messages: modelMessages,
      tools: tools as any,
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
    });

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