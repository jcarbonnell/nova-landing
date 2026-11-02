// nova-landing/src/app/api/chat/route.ts
import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { NextRequest } from 'next/server';
import { buildChatTools, toModelHistory, WALLET_READ_TOOLS } from '@/lib/chat-tools';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MCP_URL = process.env.MCP_URL || 'https://5a5223f7d1bfe777433c496b9d52ff851e927259-8000.dstack-prod5.phala.network';
const NETWORK_ID = process.env.NEXT_PUBLIC_NEAR_NETWORK || 'mainnet';
const ACCOUNT_SUFFIX = NETWORK_ID === 'mainnet' ? '.nova-sdk.near' : '.nova-sdk-7.testnet';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages } = body;
    
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Resolve a nova_session two ways (transport B):
    //   - Wallet users (SIWN): a nova_session httpOnly cookie set by
    //     /api/auth/wallet-verify. Used directly; MCP re-verifies sig/aud/iss.
    //   - Email users (Auth0): no nova_session cookie, so mint one via
    //     session-token, which re-verifies the Auth0 session and resolves the
    //     authoritative account_id from Shade. We never trust client x-account-id.
    // The wallet token's `account_id` is decoded from its verified claims, not
    // asserted by the client.
    let sessionToken: string;
    let verifiedAccountId: string;

    const walletSession = req.cookies.get('nova_session')?.value;
    if (walletSession) {
      sessionToken = walletSession;
      try {
        const claims = JSON.parse(
          Buffer.from(walletSession.split('.')[1], 'base64').toString('utf8'),
        );
        verifiedAccountId = claims.account_id;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid session' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!verifiedAccountId) {
        return new Response(JSON.stringify({ error: 'Invalid session' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      const origin = new URL(req.url).origin;
      const tokenRes = await fetch(`${origin}/api/auth/session-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.get('cookie') ?? '',
        },
        body: '{}',
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: err.error || 'Unauthorized' }), {
          status: tokenRes.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const tokenData = await tokenRes.json();
      sessionToken = tokenData.token;
      verifiedAccountId = tokenData.account_id;
    }

    // Self-custodial (SIWN wallet) session: NOVA holds no key, every write must be
    // signed by the user's wallet (path A), which this chat cannot reach. Writes are
    // therefore NOT offered as tools for wallet sessions (below): enforced in code,
    // not only in the prompt.
    const walletMode = !!walletSession;

    const toolHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
      'x-account-id': verifiedAccountId,
    };

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

    const systemPrompt = `You are NOVA, a secure file-sharing assistant powered by the NOVA SDK.

Your capabilities include:
- Uploading files with end-to-end encryption (use prepare_upload tool)
- Creating secure sharing groups
- Managing access permissions
- Tracking file analytics
- Retrieving shared files

Current user: ${verifiedAccountId}
NEAR Account: ${verifiedAccountId}
Network: ${NETWORK_ID}
${walletMode ? `
═══════════════════════════════════════════════════════════════════════════════
WALLET ACCOUNT (self-custodial):
This user signed in with their own NEAR wallet. NOVA never holds their key, so every
write (creating a group, adding or removing a member, uploading a file, setting
retention) must be signed by their wallet. That cannot be done from this chat yet:
the write tools are not available to you. You CAN read: their groups, a group's
members, a group's files, and retrieve/decrypt a file. Reads are free for wallet accounts.
If the user asks for a write, say plainly that it needs their wallet's signature and
is not available in the chat yet (the NOVA SDK's wallet mode supports it). Do not
attempt it and do not suggest a workaround.
` : ''}

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
When a user wants to upload a file they attached:
1. Ask which group if not specified
2. Call prepare_upload(group_id, filename) with the attached file's exact name
3. The user's browser encrypts and stores the file; you receive only { status, filename, cid, trans_id } or an error
4. Report the result

RETRIEVE/DOWNLOAD FILES:
When a user wants to download a file:
1. If they don't have the file reference, use get_group_transactions to find it
2. Call prepare_retrieve(group_id, ipfs_hash)
3. The user's browser decrypts and downloads the file; you receive only { status, filename } or an error

You never receive file keys or file contents: encryption and decryption happen only in the user's browser.

Available tools for files:
- prepare_upload: Upload an attached file (the browser encrypts and stores it)
- prepare_retrieve: Download and decrypt a file (the browser decrypts it)
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
      // W0: scrub key/ciphertext fields from the posted history, then convert.
      messages: await toModelHistory(messages),
      tools: buildChatTools({ callMcp: callMCPTool, walletMode }),
      // Wallet sessions: reads only. activeTools filters both what the model is
      // offered AND what the SDK will execute (a call to any other tool is rejected
      // as NoSuchToolError, never run).
      activeTools: walletMode ? [...WALLET_READ_TOOLS] : undefined,
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