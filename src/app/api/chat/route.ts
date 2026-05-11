// src/app/api/chat/route.ts
import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';

// Allow streaming responses up to 60 seconds for tool execution
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK || 'testnet';
const ACCOUNT_SUFFIX = NETWORK_ID === 'mainnet' ? '.nova-sdk.near' : '.nova-sdk-5.testnet';

console.log('=== NETWORK CONFIG ===');
console.log('NEXT_PUBLIC_NEAR_NETWORK:', process.env.NEXT_PUBLIC_NEAR_NETWORK);
console.log('NETWORK_ID resolved:', NETWORK_ID);
console.log('ACCOUNT_SUFFIX:', ACCOUNT_SUFFIX);

export async function POST(req: NextRequest) {  
  try {
    // 1. Parse request body first to check for messages
    const body = await req.json();
    const { messages, email }: { messages: UIMessage[]; email?: string } = body;
    
    // Auth from headers
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

    // 2. Get auth - wallet users don't need Auth0 session
    let accessToken: string | undefined;
    let userEmail: string | undefined;

    if (walletId) {
      // Skip Auth0 session for wallet users
      userEmail = email;
      console.log('Wallet user detected');
    } else {
      // Verify Auth0 session for email users
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

    console.log('=== CHAT ROUTE DEBUG ===');
    console.log('User type:', walletId ? 'wallet' : 'email');
    console.log('User identifier:', walletId || userEmail);
    console.log('Has accessToken:', !!accessToken);
    console.log('MCP endpoint:', `${MCP_URL}/mcp`);

    // Decode and log token claims
    if (accessToken) {
      console.log('Token first 50 chars:', accessToken.substring(0, 50));
      try {
        const parts = accessToken.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log('Token exp:', payload.exp, 'Now:', Math.floor(Date.now() / 1000));
        console.log('Token expired?:', payload.exp < Math.floor(Date.now() / 1000));
      } catch (e) {
        console.error('Token decode failed:', e);
      }
    }

    // 3. Connect to NOVA MCP server using StreamableHTTPClientTransport
    console.log('Using MCP server:', MCP_URL);
    
    // Build headers based on user type
    const mcpHeaders: Record<string, string> = {
      'x-account-id': accountId || '',
    };

    if (walletId) {
      // For wallet users: use wallet_id as a valid "token"
      mcpHeaders['Authorization'] = `Bearer wallet:${walletId}`;
      mcpHeaders['x-wallet-id'] = walletId;
    } else if (accessToken) {
      // Email users: use real Auth0 token
      mcpHeaders['Authorization'] = `Bearer ${accessToken}`;
      if (userEmail) {
        mcpHeaders['x-user-email'] = userEmail;
      }
    }
    
    console.log('Sending to MCP with headers:', {
      accountId,
      walletId: walletId || '(email user)',
      hasAuthToken: !!accessToken,
    });

    // 4. Define MCP tools with direct HTTP calls
    async function callMCPTool(toolName: string, args: any) {
      console.log(`Calling MCP tool: ${toolName}`, args);
      const response = await fetch(`${MCP_URL}/tools/${toolName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...mcpHeaders
        },
        body: JSON.stringify(args)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`MCP tool ${toolName} failed:`, errorText);
        throw new Error(`MCP tool ${toolName} failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log(`MCP tool ${toolName} result:`, result);
      return result;
    }

    const mcpTools = {
      register_group: {
        description: 'Create a new group for secure file sharing',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Unique group identifier' }
          },
          required: ['group_id']
        },
        execute: async (args: any) => callMCPTool('register_group', args)
      },
      
      add_group_member: {
        description: 'Add a member to a group',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group ID' },
            member_id: { type: 'string', description: 'Member account ID to add' }
          },
          required: ['group_id', 'member_id']
        },
        execute: async (args: any) => callMCPTool('add_group_member', args)
      },
      
      revoke_group_member: {
        description: 'Remove a member from a group (triggers key rotation)',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group ID' },
            member_id: { type: 'string', description: 'Member account ID to remove' }
          },
          required: ['group_id', 'member_id']
        },
        execute: async (args: any) => callMCPTool('revoke_group_member', args)
      },

      get_owned_groups: {
        description: 'List all groups owned by the current user',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args: any) => callMCPTool('get_owned_groups', args)
      },

      get_member_groups: {
        description: 'List all groups the current user is a member of',
        parameters: {
          type: 'object',
          properties: {}
        },
        execute: async (args: any) => callMCPTool('get_member_groups', args)
      },

      get_group_members: {
        description: 'List all members of a specific group',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group ID to query' }
          },
          required: ['group_id']
        },
        execute: async (args: any) => callMCPTool('get_group_members', args)
      },

      get_group_transactions: {
        description: 'List all file transactions in a group',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group ID to query' }
          },
          required: ['group_id']
        },
        execute: async (args: any) => callMCPTool('get_group_transactions', args)
      },

      prepare_upload: {
        description: 'Prepare file upload - returns encryption key and upload ID',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group to upload to' },
            filename: { type: 'string', description: 'Name of file to upload' }
          },
          required: ['group_id', 'filename']
        },
        execute: async (args: any) => callMCPTool('prepare_upload', args)
      },

      finalize_upload: {
        description: 'Finalize file upload after encryption',
        parameters: {
          type: 'object',
          properties: {
            upload_id: { type: 'string', description: 'Upload ID from prepare_upload' },
            encrypted_data: { type: 'string', description: 'Base64 encrypted file data' },
            file_hash: { type: 'string', description: 'SHA-256 hash of original file' }
          },
          required: ['upload_id', 'encrypted_data', 'file_hash']
        },
        execute: async (args: any) => callMCPTool('finalize_upload', args)
      },

      prepare_retrieve: {
        description: 'Prepare file retrieval - returns decryption key and encrypted data',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group containing the file' },
            ipfs_hash: { type: 'string', description: 'IPFS CID of the file' }
          },
          required: ['group_id', 'ipfs_hash']
        },
        execute: async (args: any) => callMCPTool('prepare_retrieve', args)
      },

      auth_status: {
        description: 'Check authentication status and group authorization',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Optional group ID to check authorization' }
          }
        },
        execute: async (args: any) => callMCPTool('auth_status', args)
      }
    };

    console.log('MCP tools loaded:', Object.keys(mcpTools));

    // 5. Convert UI messages to model messages
    const modelMessages = convertToModelMessages(messages);

    // 6. Stream response with Anthropic + MCP tools
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
      tools: mcpTools as any,
      // Allow multi-step tool execution (up to 5 steps)
      stopWhen: stepCountIs(5),
      onStepFinish: ({ finishReason, usage, response }) => {
        console.log('Step finished:', { 
          finishReason,
          inputTokens: usage?.inputTokens || 0,
          outputTokens: usage?.outputTokens || 0,
          messageCount: response?.messages?.length || 0,
        });
      },
    });

    // 7. Return streaming response
    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      onError: (error) => {
        console.error('Stream error:', error);
        if (error instanceof Error) {
          return error.message;
        }
        return 'An error occurred during processing';
      },
    });

  } catch (error) {
    console.error('Chat API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ 
        error: 'Chat processing failed', 
        details: errorMessage,
      }), 
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
}