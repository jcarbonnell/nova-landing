// test/check-chat-active-tools.mjs
// Harness for api/chat walletMode. Two independent layers keep a wallet session
// from executing a write tool, even if the model calls one:
//   L1 activeTools  — the AI SDK refuses unlisted tools (only from ai@6.0.231)
//   L2 custodialOnly — each write tool's execute refuses when walletMode is true
// PASS requires L2 always, and L1 on the installed ai version. A control run
// (custodial, all tools) must execute the same call.
// Run (from nova-landing/): node test/check-chat-active-tools.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { streamText, tool, stepCountIs } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { z } from 'zod';

const aiDir = dirname(createRequire(import.meta.url).resolve('ai'));
const aiVersion = JSON.parse(readFileSync(join(aiDir, '..', 'package.json'), 'utf8')).version;

// Same guard as route.ts.
const guard = (walletMode) => (run) =>
  walletMode ? Promise.reject(new Error('Writes are signed by your own wallet and are not available in the chat yet.')) : run();

async function run({ walletMode, useActiveTools, useGuard }) {
  const executed = [];
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: 'tool-call', toolCallId: 'c1', toolName: 'register_group', input: JSON.stringify({ group_id: 'x' }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } },
    ] }) }),
  });
  const custodialOnly = useGuard ? guard(walletMode) : (r) => r();
  const tools = {
    get_owned_groups: tool({ inputSchema: z.object({}), execute: async () => { executed.push('get_owned_groups'); return []; } }),
    register_group: tool({
      inputSchema: z.object({ group_id: z.string() }),
      execute: async () => custodialOnly(async () => { executed.push('register_group'); return 'created'; }),
    }),
  };
  const r = streamText({ model, tools, activeTools: useActiveTools && walletMode ? ['get_owned_groups'] : undefined,
    stopWhen: stepCountIs(1), prompt: 'create a group' });
  const parts = [];
  for await (const p of r.fullStream) parts.push(p.type);
  return { executed, parts: parts.filter((p) => /tool/.test(p)) };
}

const l1 = await run({ walletMode: true, useActiveTools: true, useGuard: false });
const l2 = await run({ walletMode: true, useActiveTools: false, useGuard: true });
const both = await run({ walletMode: true, useActiveTools: true, useGuard: true });
const control = await run({ walletMode: false, useActiveTools: true, useGuard: true });
const blocked = (r) => !r.executed.includes('register_group');

console.log(`ai@${aiVersion}`);
console.log(`  L1 activeTools only   : ${blocked(l1) ? 'blocks' : 'DOES NOT block'}  ${JSON.stringify(l1)}`);
console.log(`  L2 guard only         : ${blocked(l2) ? 'blocks' : 'DOES NOT block'}  ${JSON.stringify(l2)}`);
console.log(`  route (L1 + L2)       : ${blocked(both) ? 'blocks' : 'DOES NOT block'}`);
console.log(`  control (custodial)   : ${control.executed.includes('register_group') ? 'executes' : 'DID NOT execute'}`);
const ok = blocked(l2) && blocked(both) && blocked(l1) && control.executed.includes('register_group');
if (!blocked(l1)) console.log('  → upgrade ai to ≥ 6.0.231 (L1 is not enforced on this version)');
console.log(ok ? 'ENFORCED' : 'ENFORCEMENT FAIL');
process.exit(ok ? 0 : 1);
