// nova-landing/test/check-chat-no-secrets.ts
// W0 harness: the model never receives a file key or ciphertext.
//   Run (from nova-landing/): npx tsx test/check-chat-no-secrets.ts
// Imports the REAL tool set and history conversion from src/lib/chat-tools.ts.
// Every prompt the mock model receives is recorded and searched for the secrets.
// N4 and N5 are mutation checks: they rebuild the old behaviour and assert the
// detector catches it, so a pass in N1–N3 cannot be a blind detector.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { streamText, stepCountIs, convertToModelMessages, tool, type ToolSet, type UIMessage } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { z } from 'zod';
import {
  buildChatTools, toModelHistory, scrubToolSecrets, WALLET_READ_TOOLS, SCRUBBED,
} from '../src/lib/chat-tools';

const aiVersion = createRequire(import.meta.url)('ai/package.json').version;

const KEY = 'S0VZLW5ldmVyLXRvLXRoZS1tb2RlbC0zMmJ5dGVzLWtleSE=';
const CT = 'Q0lQSEVSVEVYVC1uZXZlci10by10aGUtbW9kZWwtYnl0ZXM=';
const leaks = (prompts: unknown[]) => {
  const s = JSON.stringify(prompts);
  return { key: s.includes(KEY), ct: s.includes(CT) };
};

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
const toolCallChunks = (toolName: string, input: object) => [
  { type: 'tool-call', toolCallId: 'c1', toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
];
const textChunks = [
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'ok' },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
];

// Mock model: first call returns `first`, later calls return text. Records prompts.
function mockModel(first: unknown[]) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options: { prompt: unknown }) => {
      prompts.push(options.prompt);
      const chunks = prompts.length === 1 ? first : textChunks;
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  } as never);
  return { model, prompts };
}

const noMcp = async () => { throw new Error('MCP must not be called in this harness'); };

// Run one chat request; return the recorded prompts and the UI stream chunk types.
async function chat(opts: {
  walletMode: boolean; first: unknown[]; tools?: Record<string, unknown>; messages?: unknown;
}) {
  const { model, prompts } = mockModel(opts.first);
  const tools = (opts.tools ?? buildChatTools({ callMcp: noMcp, walletMode: opts.walletMode })) as ToolSet;
  const r = streamText({
    model,
    tools,
    activeTools: opts.walletMode ? [...WALLET_READ_TOOLS] : undefined,
    stopWhen: stepCountIs(5),
    ...(opts.messages ? { messages: opts.messages as never } : { prompt: 'go' }),
  });
  const ui: Array<{ type: string; toolName?: string }> = [];
  for await (const c of r.toUIMessageStream()) ui.push(c as never);
  return { prompts, ui };
}
const uiHas = (ui: Array<{ type: string; toolName?: string }>, type: string, toolName: string) =>
  ui.some((c) => c.type === type && (c.toolName === undefined || c.toolName === toolName));
const uiCount = (ui: Array<{ type: string }>, type: string) => ui.filter((c) => c.type === type).length;

// A history the browser could post back: three shapes of a key-bearing output.
function leakyHistory(): UIMessage[] {
  const secret = { key: KEY, encrypted_b64: CT, ipfs_hash: 'loc/1', group_id: 'g', status: 'downloaded' };
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'get my file, the key word is fine here' }] },
    {
      id: 'a1', role: 'assistant', parts: [
        { type: 'step-start' },
        { type: 'tool-prepare_retrieve', toolCallId: 'r1', state: 'output-available',
          input: { group_id: 'g', ipfs_hash: 'loc/1' }, output: secret },
        { type: 'tool-prepare_retrieve', toolCallId: 'r2', state: 'output-available',
          input: { group_id: 'g', ipfs_hash: 'loc/2' }, output: { structuredContent: secret } },
        { type: 'tool-prepare_upload', toolCallId: 'r3', state: 'output-available',
          input: { group_id: 'g', filename: 'a.txt' },
          output: { content: [{ type: 'text', text: JSON.stringify({ ...secret, encrypted_data: CT }) }] } },
        { type: 'text', text: 'done', state: 'done' },
      ],
    },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'thanks, now list my groups' }] },
  ] as UIMessage[];
}

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}

async function main() {
  console.log(`ai@${aiVersion}`);

  await test('N1 prepare_retrieve is client-side: stream stops at the call, no server output', async () => {
    const { prompts, ui } = await chat({
      walletMode: false, first: toolCallChunks('prepare_retrieve', { group_id: 'g', ipfs_hash: 'loc/1' }),
    });
    assert.equal(prompts.length, 1, `model was called ${prompts.length}x (a server output was fed back)`);
    assert.ok(uiHas(ui, 'tool-input-available', 'prepare_retrieve'), 'browser did not receive the call');
    assert.equal(uiCount(ui, 'tool-output-available'), 0, 'server produced a tool output');
  });

  await test('N2 prepare_upload is client-side: stream stops at the call, no server output', async () => {
    const { prompts, ui } = await chat({
      walletMode: false, first: toolCallChunks('prepare_upload', { group_id: 'g', filename: 'a.txt' }),
    });
    assert.equal(prompts.length, 1);
    assert.ok(uiHas(ui, 'tool-input-available', 'prepare_upload'));
    assert.equal(uiCount(ui, 'tool-output-available'), 0);
  });

  await test('N3 a posted history carrying key + ciphertext (3 shapes) never reaches the model', async () => {
    const messages = await toModelHistory(leakyHistory());
    const { prompts } = await chat({ walletMode: false, first: textChunks, messages });
    const l = leaks(prompts);
    assert.ok(!l.key, 'key reached the model');
    assert.ok(!l.ct, 'ciphertext reached the model');
    const s = JSON.stringify(prompts);
    assert.ok(s.includes('downloaded') && s.includes('loc/2'), 'non-secret tool fields were lost');
    assert.ok(s.includes('the key word is fine here'), 'user text was altered');
  });

  await test('N4 mutation — without the scrub, the same history leaks (detector works)', async () => {
    const messages = await convertToModelMessages(leakyHistory());
    const { prompts } = await chat({ walletMode: false, first: textChunks, messages });
    const l = leaks(prompts);
    assert.ok(l.key && l.ct, 'detector failed to see the unscrubbed leak');
  });

  await test('N5 mutation — an executing prepare_retrieve leaks at step 2 (no-execute matters)', async () => {
    const real = buildChatTools({ callMcp: noMcp, walletMode: false });
    const tools = {
      ...real,
      prepare_retrieve: tool({
        inputSchema: z.object({ group_id: z.string(), ipfs_hash: z.string() }),
        execute: async () => ({ key: KEY, encrypted_b64: CT }), // the pre-W0 behaviour
      }),
    };
    const { prompts } = await chat({
      walletMode: false, tools,
      first: toolCallChunks('prepare_retrieve', { group_id: 'g', ipfs_hash: 'loc/1' }),
    });
    assert.ok(prompts.length >= 2, 'no second step');
    assert.ok(leaks(prompts.slice(1)).key, 'detector failed to see the step-2 leak');
  });

  await test('N6 wallet session: prepare_upload is refused (input error), prepare_retrieve reaches the browser', async () => {
    const up = await chat({
      walletMode: true, first: toolCallChunks('prepare_upload', { group_id: 'g', filename: 'a.txt' }),
    });
    assert.ok(!uiHas(up.ui, 'tool-input-available', 'prepare_upload'), 'wallet upload call reached the browser');
    assert.ok(uiHas(up.ui, 'tool-input-error', 'prepare_upload'), 'no input error for the refused call');
    const down = await chat({
      walletMode: true, first: toolCallChunks('prepare_retrieve', { group_id: 'g', ipfs_hash: 'loc/1' }),
    });
    assert.ok(uiHas(down.ui, 'tool-input-available', 'prepare_retrieve'));
  });

  await test('N7 scrub marks each removed field and leaves non-tool parts untouched', async () => {
    const out = scrubToolSecrets(leakyHistory());
    const parts = out[1].parts as Array<Record<string, any>>;
    assert.equal(parts[1].output.key, SCRUBBED);
    assert.equal(parts[2].output.structuredContent.encrypted_b64, SCRUBBED);
    const nested = JSON.parse(parts[3].output.content[0].text);
    assert.equal(nested.encrypted_data, SCRUBBED);
    assert.equal(nested.key, SCRUBBED);
    assert.deepEqual(out[0], leakyHistory()[0]);
    assert.deepEqual(parts[4], leakyHistory()[1].parts[4]);
  });

  const total = 7;
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });