import { streamText, convertToModelMessages, UIMessage, stepCountIs } from 'ai';
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
            group_id: { type: 'string' },
            member_id: { type: 'string' }
          },
          required: ['group_id', 'member_id']
        },
        execute: async (args: any) => callMCPTool('add_group_member', args)
      },

      revoke_group_member: {
        description: 'Remove a member from a group',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string' },
            member_id: { type: 'string' }
          },
          required: ['group_id', 'member_id']
        },
        execute: async (args: any) => callMCPTool('revoke_group_member', args)
      },

      get_owned_groups: {
        description: 'List all groups owned by the current user',
        parameters: { type: 'object', properties: {} },
        execute: async () => callMCPTool('get_owned_groups', {})
      },

      get_member_groups: {
        description: 'List all groups the current user is a member of',
        parameters: { type: 'object', properties: {} },
        execute: async () => callMCPTool('get_member_groups', {})
      },

      get_group_members: {
        description: 'List members of a specific group',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string' }
          },
          required: ['group_id']
        },
        execute: async (args: any) => callMCPTool('get_group_members', args)
      },

      get_group_transactions: {
        description: 'List file transactions in a group',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string' }
          },
          required: ['group_id']
        },
        execute: async (args: any) => callMCPTool('get_group_transactions', args)
      },

      prepare_upload: {
        description: 'Prepare file upload - returns encryption key',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string' },
            filename: { type: 'string' }
          },
          required: ['group_id', 'filename']
        },
        execute: async (args: any) => callMCPTool('prepare_upload', args)
      },

      prepare_retrieve: {
        description: 'Prepare file retrieval - returns decryption key',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string' },
            ipfs_hash: { type: 'string' }
          },
          required: ['group_id', 'ipfs_hash']
        },
        execute: async (args: any) => callMCPTool('prepare_retrieve', args)
      },

      auth_status: {
        description: 'Check authentication status',
        parameters: {
          type: 'object',
          properties: {
            group_id: { type: 'string' }
          }
        },
        execute: async (args: any) => callMCPTool('auth_status', args || {})
      }
    };

    const modelMessages = convertToModelMessages(messages);
    const userIdentifier = walletId || userEmail;

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: `You are NOVA, a secure file-sharing assistant.
Current user: ${userIdentifier}
NEAR Account: ${accountId}
Network: ${NETWORK_ID}

[Keep your full system prompt here]`,
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