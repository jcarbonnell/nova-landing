// src/app/api/chat/route.ts
import { streamText, convertToModelMessages, UIMessage, stepCountIs} from 'ai';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { anthropic } from '@ai-sdk/anthropic';
import { auth0 } from '@/lib/auth0';
import { NextRequest } from 'next/server';

// Allow streaming responses up to 60 seconds for tool execution
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://nova-mcp.fastmcp.app';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(req: NextRequest) {
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  
  try {
    // 1. Verify Auth0 session
    const session = await auth0.getSession();
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const accessToken = session.tokenSet?.accessToken;
    const userEmail = session.user.email;

    // 2. Parse request body
    const body = await req.json();
    const { messages, accountId }: { messages: UIMessage[]; accountId?: string } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. Connect to NOVA MCP server via HTTP
    console.log('Connecting to NOVA MCP server:', MCP_URL);
    
    mcpClient = await createMCPClient({
      transport: {
        type: 'http',
        url: `${MCP_URL}/mcp`,
        headers: accessToken ? {
          'Authorization': `Bearer ${accessToken}`,
          'X-User-Email': userEmail,
          'X-Account-Id': accountId || '',
        } : {
          'X-User-Email': userEmail,
          'X-Account-Id': accountId || '',
        },
      },
    });

    // 4. Get tools from MCP server
    const mcpTools = await mcpClient.tools();
    console.log('MCP tools loaded:', Object.keys(mcpTools));

    // 5. Convert UI messages to model messages
    const modelMessages = convertToModelMessages(messages);

    // 6. Stream response with Claude + MCP tools
    const result = streamText({
      model: anthropic('claude-sonnet-4-20250514'),
      system: `You are NOVA, a secure file-sharing assistant powered by the NOVA SDK.

Your capabilities include:
- Uploading files with end-to-end encryption (use composite_upload tool)
- Creating secure sharing groups
- Managing access permissions
- Tracking file analytics
- Retrieving shared files

Current user: ${userEmail}
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
    });

    // 7. Return streaming response
    return result.toUIMessageStreamResponse({
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
    
  } finally {
    // Always close MCP client to release resources
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (closeError) {
        console.warn('Error closing MCP client:', closeError);
      }
    }
  }
}