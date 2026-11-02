// nova-landing/src/lib/chat-tools.ts
//
// The chat's tool set, in one module the route AND the harnesses import, so a
// passing harness is a statement about the deployed code, not about a copy.
//
// W0 rule ("WebCrypto executes, LLM orchestrates", §5.11): the model never sees a
// file key or ciphertext. prepare_upload and prepare_retrieve are CLIENT-SIDE tools
// (no execute): the model proposes the call, the browser fetches the key through
// /api/nova/prepare-* , encrypts or decrypts locally, and reports back with
// addToolOutput({ status, filename, cid, trans_id }) — no secrets. Two layers:
//   1. no execute ⇒ the server never produces a tool output carrying a key;
//   2. scrubToolSecrets() strips key / ciphertext fields from any tool part the
//      browser posts back (an old, buggy or forged history) before the history is
//      converted for the model.
// Harness: test/check-chat-no-secrets.ts.

import { tool, convertToModelMessages, type UIMessage } from 'ai';
import { z } from 'zod';

export type CallMcp = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

// The only tools a wallet (self-custodial) session may use in the chat.
export const WALLET_READ_TOOLS = [
  'get_owned_groups',
  'get_member_groups',
  'get_group_members',
  'get_group_transactions',
  'prepare_retrieve',
] as const;

export const CUSTODIAL_ONLY_MESSAGE =
  'Writes are signed by your own wallet and are not available in the chat yet.';

export function buildChatTools({ callMcp, walletMode }: { callMcp: CallMcp; walletMode: boolean }) {
  // Second layer, independent of the AI SDK version: a write tool refuses to run
  // for a wallet session even if the model calls it. (activeTools only blocks
  // execution from ai@6.0.231; test/check-chat-active-tools.mjs checks both.)
  function custodialOnly<T>(run: () => Promise<T>): Promise<T> {
    if (walletMode) return Promise.reject(new Error(CUSTODIAL_ONLY_MESSAGE));
    return run();
  }

  return {
    // ─── Query tools ───
    get_owned_groups: tool({
      description: 'List all groups owned by the current user',
      inputSchema: z.object({}),
      execute: async () => callMcp('get_owned_groups', {}),
    }),
    get_member_groups: tool({
      description: 'List all groups the user is a member of (includes owned groups)',
      inputSchema: z.object({}),
      execute: async () => callMcp('get_member_groups', {}),
    }),
    get_group_members: tool({
      description: 'List all members of a specific group',
      inputSchema: z.object({
        group_id: z.string().describe('The group identifier'),
      }),
      execute: async ({ group_id }) => callMcp('get_group_members', { group_id }),
    }),
    get_group_transactions: tool({
      description: 'List all files/transactions in a specific group',
      inputSchema: z.object({
        group_id: z.string().describe('The group identifier'),
      }),
      execute: async ({ group_id }) => callMcp('get_group_transactions', { group_id }),
    }),

    // ─── Group management ───
    register_group: tool({
      description: 'Create a new group for secure file sharing. The caller becomes the owner.',
      inputSchema: z.object({
        group_id: z.string().describe('Unique group identifier (e.g., "my-team")'),
      }),
      execute: async ({ group_id }) => custodialOnly(() => callMcp('register_group', { group_id })),
    }),
    add_group_member: tool({
      description: 'Add a member to a group (owner only)',
      inputSchema: z.object({
        group_id: z.string().describe('The group identifier'),
        member_id: z.string().describe('NEAR account ID of the member to add'),
      }),
      execute: async ({ group_id, member_id }) =>
        custodialOnly(() => callMcp('add_group_member', { group_id, member_id })),
    }),
    revoke_group_member: tool({
      description: 'Remove a member from a group (owner only, automatically rotates encryption key)',
      inputSchema: z.object({
        group_id: z.string().describe('The group identifier'),
        member_id: z.string().describe('NEAR account ID of the member to remove'),
      }),
      execute: async ({ group_id, member_id }) =>
        custodialOnly(() => callMcp('revoke_group_member', { group_id, member_id })),
    }),

    // ─── File operations: CLIENT-SIDE (no execute; the browser runs them) ───
    prepare_upload: tool({
      description:
        'Upload a file the user attached to a group. The browser encrypts and stores it; ' +
        'you never receive the key or the file bytes. Returns { status, filename, cid, trans_id } ' +
        'or an error.',
      inputSchema: z.object({
        group_id: z.string().describe('The group to upload to'),
        filename: z.string().describe('Name of the attached file to upload'),
      }),
    }),
    prepare_retrieve: tool({
      description:
        'Download and decrypt a file. The browser fetches and decrypts it locally; you never ' +
        'receive the key or the file bytes. Returns { status, filename } or an error.',
      inputSchema: z.object({
        group_id: z.string().describe('The group containing the file'),
        ipfs_hash: z.string().describe('The file reference (CID or FastFS location) from get_group_transactions'),
      }),
    }),
  };
}

// ── History scrub ────────────────────────────────────────────────────────────

// Fields that carry a file key or ciphertext anywhere in MCP / chat payloads.
const SECRET_FIELDS = new Set(['key', 'encrypted_b64', 'encrypted_data']);
export const SCRUBBED = '[removed: never sent to the model]';

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') {
    // Older tool outputs nested the payload as a JSON string (content[0].text).
    const t = value.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        return JSON.stringify(scrubValue(JSON.parse(t), depth + 1));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELDS.has(k) ? SCRUBBED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function isToolPart(part: { type?: unknown }): boolean {
  return part.type === 'dynamic-tool' || (typeof part.type === 'string' && part.type.startsWith('tool-'));
}

/**
 * The ONLY way the route turns the posted UI history into model messages:
 * scrub first, then convert. The harness calls this same function.
 */
export async function toModelHistory(messages: UIMessage[]) {
  return convertToModelMessages(scrubToolSecrets(messages));
}

/** Strip key / ciphertext fields from every tool part's input and output. */
export function scrubToolSecrets<M extends { parts?: unknown[] }>(messages: M[]): M[] {
  return messages.map((m) => {
    if (!Array.isArray(m.parts)) return m;
    return {
      ...m,
      parts: m.parts.map((p) => {
        const part = p as Record<string, unknown>;
        if (!part || typeof part !== 'object' || !isToolPart(part)) return p;
        const next: Record<string, unknown> = { ...part };
        if ('input' in next) next.input = scrubValue(next.input);
        if ('output' in next) next.output = scrubValue(next.output);
        return next;
      }),
    };
  });
}