// nova-landing/src/app/app/chat/page.tsx
//
// §8 step 4 (4a) — the Chat section. ChatInterface, migrated from HomeClient's
// "Try it" box to its own gated route, fed gate-resolved identity as props.
//
// ChatInterface is props-only (no wallet/Auth0 hooks) — verified — so this is a
// straight render, no decoupling. It authenticates via COOKIES (the chat +
// finalize-upload routes resolve the session server-side and ignore the
// x-account-id header ChatInterface sends), and requireNovaIdentity establishes
// that same cookie session here, so auth lines up exactly as it does on /.
//
// Height: ChatInterface's root is h-full, so it needs an explicit-height parent
// (on / that's a fixed-height box). DashboardChrome's <main> is flex-1, not
// fixed, so we wrap the chat in a tall responsive box.

import { requireNovaIdentity } from '@/lib/require-identity';
import DashboardChrome from '../../DashboardChrome';
import ChatInterface from '@/components/ChatInterface';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ChatPage() {
  const { email, accountId } = await requireNovaIdentity();
  return (
    <DashboardChrome email={email} accountId={accountId}>
      <h1 className="font-museo text-2xl md:text-3xl font-black text-nova-text mb-2 tracking-tight">
        Chat
      </h1>
      <p className="font-space text-nova-text-dim mb-6">
        Talk to your encrypted memory.
      </p>
      <div className="h-[600px] md:h-[650px] lg:h-[700px]">
        <ChatInterface accountId={accountId} email={email} />
      </div>
    </DashboardChrome>
  );
}