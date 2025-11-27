// src/app/api/chat/route.ts
import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { groq } from '@ai-sdk/groq';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';

// Allow streaming responses up to 60 seconds for tool execution
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app';

export async function POST(req: NextRequest) {
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  
  try {
    // 1. Parse request body first to check for wallet user
    const body = await req.json();
    const { messages, accountId, email, walletId }: { 
      messages: UIMessage[]; 
      accountId?: string;
      email?: string;
      walletId?: string;
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), { 
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
      console.log('Wallet user detected:', walletId);
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
    if (accessToken) {
      console.log('Token first 50 chars:', accessToken.substring(0, 50));
    }
    console.log('MCP endpoint:', `${MCP_URL}/mcp`);

    // Decode and log token claims
    if (accessToken) {
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
      'X-Account-Id': accountId || '',
    };

    if (accessToken) {
      mcpHeaders['Authorization'] = `Bearer ${accessToken}`;
    }
    if (userEmail) {
      mcpHeaders['X-User-Email'] = userEmail;
    }
    if (walletId) {
      mcpHeaders['X-Wallet-Id'] = walletId;
    }

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

    // 6. Stream response with Groq + MCP tools
    const userIdentifier = walletId || userEmail;

    const result = streamText({
      model: groq('llama-3.3-70b-versatile'),
      system: `You are NOVA, a secure file-sharing assistant powered by the NOVA SDK.

Your capabilities include:
- Uploading files with end-to-end encryption (use composite_upload tool)
- Creating secure sharing groups
- Managing access permissions
- Tracking file analytics
- Retrieving shared files

Current user: ${userIdentifier}
NEAR Account: ${accountId || 'Not connected'}

When users want to upload files, use the composite_upload tool with their file data.
When users ask about their files, use appropriate tools to list or retrieve them.
Always explain what you're doing and confirm successful operations.

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