// nova-landing/src/lib/dashboard-client.ts
//
// 2c-i — the dashboard's client data layer. All /api/nova/* reads go through
// here so fetch semantics, the 401→re-auth behaviour, and the owner/member merge
// live in ONE place (2c's component stays presentational).
//
// ─────────────────────────────────────────────────────────────────────────────
// SECURITY INVARIANT — no fetched data survives a logout. Read before editing.
//
//   • NO persistent cache of any kind. This module keeps NO module-level state,
//     NO localStorage / sessionStorage / IndexedDB, NO in-memory singleton
//     holding results. Fetched data lives ONLY in the calling component's React
//     state, which is destroyed when the tree unmounts.
//   • Sign-out is a FULL-DOCUMENT navigation (DashboardShell → window.location
//     to /api/auth/dashboard-logout). That replaces the page and tears down the
//     entire React tree + its state — so there is nothing left in memory to leak.
//     ⚠️ STANDING INVARIANT: dashboard sign-out must remain a hard navigation.
//        If a future rework (§D1 TanStack) makes it a soft route change, the
//        "state dies with the component" guarantee weakens and this must be
//        re-audited.
//   • Every request sets `cache: 'no-store'` so the BROWSER's HTTP cache keeps no
//     copy (a cached GET could otherwise be served to a back-button nav).
//   • Data cannot be re-fetched without a live session: every /api/nova/* route
//     resolves identity server-side and returns 401 with no cookie/Auth0 session
//     (proven in 2b). A 401 here redirects to '/', so a stale view can't refresh.
//
// The net effect: no store to leak from, state destroyed on logout, no fetch
// possible unauthenticated. Do not introduce a cache without revisiting all four.
// ─────────────────────────────────────────────────────────────────────────────

export type GroupRole = 'owner' | 'member';

export interface GroupSummary {
  group_id: string;
  roles: GroupRole[]; // ['owner','member'] for own groups; ['member'] for others
}

// Mirrors the SDK/Phase-0.5 enriched shape (server.py get_group_transactions).
export interface DeletionRecord {
  deleted_at: string;
  deleted_by: string;
  reason: 'MemberRevocation' | 'OwnerRequest' | 'RetentionPolicy' | 'ComplianceRequest';
}

export interface Transaction {
  trans_id: string;
  group_id: string;
  user_id: string;
  file_hash: string;
  ipfs_hash: string; // location: a Qm…/bafy… CID (legacy) OR a FastFS path
  backend: 'FastFS' | 'Ipfs' | null; // null ⇒ legacy row with no meta
  timestamp: string | null; // ns as string; divide by 1e6 for a Date. null ⇒ legacy
  deleted: DeletionRecord | null; // null ⇒ active (not tombstoned)
}

// Thrown for non-401 failures so the component can show an inline error. A 401
// never reaches the caller — novaFetch redirects before returning.
//
// `walletSignerUnavailable` marks the specific, PERMANENT case where a wallet
// (self-custody) user reads a PRIVATE group's members/transactions: those route
// through MCP's signed call_contract path, which asks Shade for a custodial key
// the wallet user does not have → Shade 501s → MCP wraps it as a 500 with a
// "Failed to get signer … Shade key retrieval failed: 501" message. Retry is
// futile (it's an architectural gap, not a transient error), so the UI shows a
// distinct, retry-less explanation. Resolves when the deferred non-signed reader
// path / client-side signing (§5.11-B) lands. Detected by message signature
// because MCP does not surface a structured code here (the RuntimeError string
// is all we get on the wire).
export class DashboardFetchError extends Error {
  public walletSignerUnavailable: boolean;
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DashboardFetchError';
    this.walletSignerUnavailable =
      /Shade key retrieval failed:\s*501/i.test(message) ||
      /Failed to get signer/i.test(message);
  }
}

/**
 * GET a same-origin /api/nova/* endpoint.
 *   - cache:'no-store' — the browser keeps no copy (logout-leak guard).
 *   - credentials:'same-origin' — the httpOnly session cookie rides the request.
 *   - 401 → redirect to '/' (the surface offering both email + wallet re-auth),
 *     matching the /app gate's unauth behaviour. Never returns on a 401.
 *   - other non-2xx → throw DashboardFetchError with the server's message.
 */
async function novaFetch<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new DashboardFetchError(0, 'Network error');
  }

  if (res.status === 401) {
    // Session expired / not authenticated. Clean re-auth: full navigation to /.
    // Never a broken screen. Returns a never-resolving promise so callers don't
    // continue past the redirect.
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
    return new Promise<T>(() => {}); // unreachable resolution; page is navigating
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON body; keep the generic message
    }
    throw new DashboardFetchError(res.status, message);
  }

  return (await res.json()) as T;
}

/**
 * Load the signed-in account's groups, merged with owner precedence.
 *
 * Fetches owned + member lists (an owner is auto-added as a member, so owned
 * groups appear in BOTH). Merge + tag:
 *   - in owned AND member  → roles ['owner','member']   (your own groups)
 *   - in member only       → roles ['member']            (someone else's group)
 * An owned-but-not-member case shouldn't occur (owner ⊆ member), but is handled
 * as ['owner'] defensively rather than dropped.
 */
export async function loadGroups(): Promise<GroupSummary[]> {
  const [owned, member] = await Promise.all([
    novaFetch<string[]>('/api/nova/owned-groups'),
    novaFetch<string[]>('/api/nova/member-groups'),
  ]);

  const ownedSet = new Set(owned);
  const memberSet = new Set(member);
  const all = new Set<string>([...owned, ...member]);

  const summaries: GroupSummary[] = [];
  for (const group_id of all) {
    const roles: GroupRole[] = [];
    if (ownedSet.has(group_id)) roles.push('owner');
    if (memberSet.has(group_id)) roles.push('member');
    summaries.push({ group_id, roles });
  }

  // Owned groups first (roles includes 'owner'), then alphabetical within each
  // bucket — a stable, predictable order for the list.
  summaries.sort((a, b) => {
    const aOwner = a.roles.includes('owner') ? 0 : 1;
    const bOwner = b.roles.includes('owner') ? 0 : 1;
    if (aOwner !== bOwner) return aOwner - bOwner;
    return a.group_id.localeCompare(b.group_id);
  });

  return summaries;
}

/** Members of one group (account-id strings). */
export async function loadGroupMembers(groupId: string): Promise<string[]> {
  const q = new URLSearchParams({ group_id: groupId }).toString();
  return novaFetch<string[]>(`/api/nova/group-members?${q}`);
}

/** Enriched transactions of one group (Phase 0.5 shape). */
export async function loadGroupTransactions(groupId: string): Promise<Transaction[]> {
  const q = new URLSearchParams({ group_id: groupId }).toString();
  return novaFetch<Transaction[]>(`/api/nova/group-transactions?${q}`);
}