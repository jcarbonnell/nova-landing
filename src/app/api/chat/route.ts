import Anthropic from '@anthropic-ai/sdk';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK || 'mainnet';
const ACCOUNT_SUFFIX = NETWORK_ID === 'mainnet' ? '.nova-sdk.near' : '.nova-sdk-6.testnet';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

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

    // Tool execution function
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

    // Define tools in Anthropic format
    const tools: Anthropic.Tool[] = [
      {
        name: 'register_group',
        description: 'Create a new group for secure file sharing',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Unique group identifier' }
          },
          required: ['group_id']
        }
      },
      {
        name: 'add_group_member',
        description: 'Add a member to a group',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group identifier' },
            member_id: { type: 'string', description: 'Member account ID' }
          },
          required: ['group_id', 'member_id']
        }
      },
      {
        name: 'revoke_group_member',
        description: 'Remove a member from a group',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group identifier' },
            member_id: { type: 'string', description: 'Member account ID' }
          },
          required: ['group_id', 'member_id']
        }
      },
      {
        name: 'get_owned_groups',
        description: 'List all groups owned by the current user',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_member_groups',
        description: 'List all groups the current user is a member of',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_group_members',
        description: 'List members of a specific group',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group ID to query' }
          },
          required: ['group_id']
        }
      },
      {
        name: 'get_group_transactions',
        description: 'List file transactions in a group',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group ID to query' }
          },
          required: ['group_id']
        }
      },
      {
        name: 'prepare_upload',
        description: 'Prepare file upload - returns encryption key',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group to upload to' },
            filename: { type: 'string', description: 'Filename' }
          },
          required: ['group_id', 'filename']
        }
      },
      {
        name: 'prepare_retrieve',
        description: 'Prepare file retrieval - returns decryption key',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Group containing file' },
            ipfs_hash: { type: 'string', description: 'IPFS CID' }
          },
          required: ['group_id', 'ipfs_hash']
        }
      },
      {
        name: 'auth_status',
        description: 'Check authentication status',
        input_schema: {
          type: 'object',
          properties: {
            group_id: { type: 'string', description: 'Optional group ID' }
          }
        }
      }
    ];

    console.log('Tools defined:', tools.length);

    // Convert messages to Anthropic format - handle AI SDK message structure
    const anthropicMessages = messages
      .filter((msg: any) => msg.role !== 'system')
      .map((msg: any) => {
        let content: string;
        
        // Handle parts array (AI SDK format)
        if (msg.parts && Array.isArray(msg.parts)) {
          content = msg.parts
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('\n');
        }
        // Handle direct content string
        else if (typeof msg.content === 'string') {
          content = msg.content;
        }
        // Handle content array
        else if (Array.isArray(msg.content)) {
          content = msg.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('\n');
        }
        // Handle content.text
        else if (msg.content?.text) {
          content = msg.content.text;
        }
        // Fallback
        else {
          console.log('Unknown message format:', msg);
          content = JSON.stringify(msg);
        }

        return {
          role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: content
        };
      })
      .filter((msg: any) => msg.content && msg.content.trim().length > 0);

    console.log('Converted messages:', anthropicMessages.length);
    if (anthropicMessages.length > 0) {
      console.log('First message:', JSON.stringify(anthropicMessages[0]));
    }

    if (anthropicMessages.length === 0) {
      console.error('No valid messages after conversion');
      console.error('Original messages:', JSON.stringify(messages, null, 2));
      return new Response(
        JSON.stringify({ error: 'No valid messages' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    // Create stream WITHOUT tools first (to test basic streaming)
    const stream = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: tools,
      stream: true,
    });

    // Convert Anthropic stream to AI SDK format
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          let messageId = 0;
          
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && 
                chunk.delta.type === 'text_delta') {
              // Send in AI SDK text format
              const line = `0:"${chunk.delta.text.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"\n`;
              controller.enqueue(encoder.encode(line));
            } 
            else if (chunk.type === 'content_block_start' && 
                    chunk.content_block.type === 'tool_use') {
              console.log('Tool call:', chunk.content_block.name);
              // TODO: Handle tool calls
            }
            else if (chunk.type === 'message_start') {
              console.log('Message started');
            }
            else if (chunk.type === 'message_delta') {
              console.log('Message delta:', chunk.delta);
            }
          }
          
          // Send completion marker
          controller.enqueue(encoder.encode('e:{"finishReason":"stop"}\n'));
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          controller.enqueue(encoder.encode(`3:${JSON.stringify(errorMessage)}\n`));
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
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