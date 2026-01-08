// src/app/api/chat/route.ts
import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { anthropic } from '@ai-sdk/anthropic';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';

// Allow streaming responses up to 60 seconds for tool execution
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app';
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK || 'testnet';
const ACCOUNT_SUFFIX = NETWORK_ID === 'mainnet' ? '.nova-sdk.near' : '.nova-sdk-5.testnet';

console.log('=== NETWORK CONFIG ===');
console.log('NEXT_PUBLIC_NEAR_NETWORK:', process.env.NEXT_PUBLIC_NEAR_NETWORK);
console.log('NETWORK_ID resolved:', NETWORK_ID);
console.log('ACCOUNT_SUFFIX:', ACCOUNT_SUFFIX);

export async function POST(req: NextRequest) {
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  
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
    const mcpEndpoint = new URL(`${MCP_URL}`);
    console.log('Connecting to NOVA MCP server:', mcpEndpoint.toString());
    
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

    // Create the transport with authentication headers
    const transport = new StreamableHTTPClientTransport(mcpEndpoint, {
      requestInit: {
        headers: mcpHeaders,
      },
    });

    // Create the MCP client with the transport
    mcpClient = await createMCPClient({
      transport,
    });

    // 4. Get tools from MCP server
    const mcpTools = await mcpClient.tools();
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

IMPORTANT - FILE OPERATIONS:
1. When uploading files with composite_upload:
  - Required: group_id, user_id, data (base64), filename
  - For payload_b64 and sig_hex: ALWAYS pass "auto" - the server handles signing automatically
  - Do NOT ask the user for payload_b64 or sig_hex

2. When retrieving files with composite_retrieve:
  - Required: group_id, ipfs_hash  
  - For payload_b64 and sig_hex: ALWAYS pass "auto" - the server handles signing automatically
    
Example composite_upload call:
{
  "group_id": "my-group",
  "user_id": "alice.nova-sdk.near", 
  "data": "<base64-encoded-file>",
  "filename": "document.pdf",
  "payload_b64": "auto",
  "sig_hex": "auto"
}

3. For group management:
   - register_group: Create a new group (you become owner)
   - add_group_member: Add member to your group
   - revoke_group_member: Remove member (key rotation happens automatically)

When users upload images or files:
- Acknowledge the file type and content
- Ask which group they want to upload to (or offer to create a new one)
- Explain the encryption and IPFS storage process
- Confirm successful uploads with the CID and transaction ID

Be helpful, concise, and security-conscious.`,
      messages: modelMessages,
      tools: mcpTools,
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
      // Close MCP client when streaming finishes
      onFinish: async () => {
        if (mcpClient) {
          try {
            await mcpClient.close();
            mcpClient = null;
          } catch (closeError) {
            console.warn('Error closing MCP client in onFinish:', closeError);
          }
        }
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
    
    // Close MCP client on error
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (closeError) {
        console.warn('Error closing MCP client on error:', closeError);
      }
    }
    
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