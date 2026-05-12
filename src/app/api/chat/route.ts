import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  
  try {
    const body = await req.json();
    const { messages, email }: { messages: UIMessage[]; email?: string } = body;
    
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
      userEmail = email;
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

    console.log('=== CHAT ROUTE DEBUG ===');
    console.log('User type:', walletId ? 'wallet' : 'email');
    console.log('MCP endpoint:', MCP_URL);

    // Build MCP headers
    const mcpHeaders: Record<string, string> = {
      'x-account-id': accountId || '',
    };

    if (walletId) {
      mcpHeaders['Authorization'] = `Bearer wallet:${walletId}`;
      mcpHeaders['x-wallet-id'] = walletId;
    } else if (accessToken) {
      mcpHeaders['Authorization'] = `Bearer ${accessToken}`;
      if (userEmail) {
        mcpHeaders['x-user-email'] = userEmail;
      }
    }

    // Create MCP client with StreamableHTTPClientTransport
    const mcpEndpoint = new URL(MCP_URL);
    console.log('Connecting to MCP:', mcpEndpoint.toString());
    
    const transport = new StreamableHTTPClientTransport(mcpEndpoint, {
      requestInit: {
        headers: mcpHeaders,
      },
    });

    mcpClient = await createMCPClient({
      transport,
    });

    // Get tools from MCP server (this uses the MCP protocol)
    const mcpTools = await mcpClient.tools();
    console.log('MCP tools loaded:', Object.keys(mcpTools));

    // Convert UI messages to model messages
    const modelMessages = convertToModelMessages(messages);

    // Stream response with Anthropic + MCP tools
    const userIdentifier = walletId || userEmail;

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: `You are NOVA, a secure file-sharing assistant powered by the NOVA SDK.

Current user: ${userIdentifier}
NEAR Account: ${accountId || 'Not connected'}
Network: ${NETWORK_ID}

[Rest of your system prompt - keep it the same]`,
      messages: modelMessages,
      tools: mcpTools,
      stopWhen: stepCountIs(5),
      onStepFinish: ({ finishReason, usage, response }) => {
        console.log('Step finished:', { 
          finishReason,
          inputTokens: usage?.inputTokens || 0,
          outputTokens: usage?.outputTokens || 0,
        });
      },
      onFinish: async () => {
        if (mcpClient) {
          try {
            await mcpClient.close();
            mcpClient = null;
          } catch (closeError) {
            console.warn('Error closing MCP client:', closeError);
          }
        }
      },
    });

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      onError: (error) => {
        console.error('Stream error:', error);
        return error instanceof Error ? error.message : 'An error occurred';
      },
    });

  } catch (error) {
    console.error('Chat API error:', error);
    
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