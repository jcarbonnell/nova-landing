// nova-landing/src/app/DashboardBody.tsx
//
// 2c-ii — the dashboard's read surface. Merged owner/member group list on the
// left; clicking a group loads its members + enriched transactions in the detail
// panel (beside the list on desktop/tablet, below it on mobile). Viewer-only:
// no mutations (hard scope for v0.1). All data comes through dashboard-client
// (2c-i), so the logout-leak guards and the 401→'/' behaviour live in ONE place.
//
// Per-section state: the group list, the members panel, and the transactions
// panel each track their own loading/error independently — a private group whose
// detail read fails does not blank the list, and members failing doesn't hide
// transactions.
//
// Transaction columns (2c functional set; Phase 4 adds deletion actor/reason):
//   uploader (display name) · short file hash · backend badge (FastFS | Legacy) ·
//   date (FastFS timestamp; '—' for legacy) · a "deleted" pill when tombstoned.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  loadGroups,
  loadGroupMembers,
  loadGroupTransactions,
  DashboardFetchError,
  type GroupSummary,
  type Transaction,
} from '@/lib/dashboard-client';

interface DashboardBodyProps {
  accountId: string;
}

// ── small presentational helpers ─────────────────────────────────────────────

function displayName(id: string): string {
  return id.split('.')[0];
}

function shortHash(h: string): string {
  return h ? h.slice(0, 10) : '';
}

// timestamp is ns-as-string on FastFS rows, null on legacy. Divide by 1e6 → ms.
function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const ms = Number(ts) / 1e6;
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function isFastFS(tx: Transaction): boolean {
  return tx.backend === 'FastFS';
}

function errMessage(e: unknown): string {
  if (e instanceof DashboardFetchError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

// ── badges ───────────────────────────────────────────────────────────────────

function RoleBadges({ roles }: { roles: GroupSummary['roles'] }) {
  return (
    <span className="flex gap-1 shrink-0">
      {roles.includes('owner') && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-600 text-white">
          owner
        </span>
      )}
      {roles.includes('member') && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/20 border border-purple-400/30 text-purple-200">
          member
        </span>
      )}
    </span>
  );
}

function BackendBadge({ tx }: { tx: Transaction }) {
  return isFastFS(tx) ? (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-600 text-white">
      FastFS
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-900/40 border border-purple-500/30 text-purple-400">
      Legacy
    </span>
  );
}

// ── inline error row (per section) ───────────────────────────────────────────

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <AlertCircle size={16} className="shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 text-red-200 hover:text-white transition-colors"
      >
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-purple-300 text-sm py-4">
      <Loader2 size={16} className="animate-spin" />
      <span>{label}</span>
    </div>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

export default function DashboardBody({ accountId }: DashboardBodyProps) {
  // Group list
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  // Selection + detail
  const [selected, setSelected] = useState<string | null>(null);
  const [detailReloadKey, setDetailReloadKey] = useState(0);

  const [members, setMembers] = useState<string[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [txsLoading, setTxsLoading] = useState(false);
  const [txsError, setTxsError] = useState<string | null>(null);

  // Load the merged group list. (A 401 inside novaFetch navigates to '/' and
  // never resolves, so it won't surface here as an error.)
  const loadList = useCallback(() => {
    setGroupsLoading(true);
    setGroupsError(null);
    loadGroups()
      .then((g) => { setGroups(g); setGroupsLoading(false); })
      .catch((e) => { setGroupsError(errMessage(e)); setGroupsLoading(false); });
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Load the selected group's detail. `cancelled` guards against a slow response
  // from a previously-selected group overwriting the current selection.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;

    setMembers(null); setMembersError(null); setMembersLoading(true);
    setTxs(null); setTxsError(null); setTxsLoading(true);

    loadGroupMembers(selected)
      .then((m) => { if (!cancelled) { setMembers(m); setMembersLoading(false); } })
      .catch((e) => { if (!cancelled) { setMembersError(errMessage(e)); setMembersLoading(false); } });

    loadGroupTransactions(selected)
      .then((t) => { if (!cancelled) { setTxs(t); setTxsLoading(false); } })
      .catch((e) => { if (!cancelled) { setTxsError(errMessage(e)); setTxsLoading(false); } });

    return () => { cancelled = true; };
  }, [selected, detailReloadKey]);

  const retryDetail = () => setDetailReloadKey((k) => k + 1);

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* ── Group list ─────────────────────────────────────────────────────── */}
      <div className="w-full md:w-1/3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-museo text-lg font-bold text-white">Groups</h2>
          {groups && !groupsLoading && (
            <span className="text-xs text-purple-400">{groups.length}</span>
          )}
        </div>

        {groupsLoading && <Spinner label="Loading groups…" />}

        {groupsError && !groupsLoading && (
          <ErrorRow message={groupsError} onRetry={loadList} />
        )}

        {groups && !groupsLoading && !groupsError && groups.length === 0 && (
          <p className="font-space text-sm text-purple-400 py-4">
            You&apos;re not in any groups yet.
          </p>
        )}

        {groups && !groupsLoading && !groupsError && groups.length > 0 && (
          <ul className="flex flex-col gap-2">
            {groups.map((g) => {
              const active = g.group_id === selected;
              return (
                <li key={g.group_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(g.group_id)}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-purple-400 bg-purple-600/30'
                        : 'border-purple-500/30 bg-purple-900/20 hover:bg-purple-800/30'
                    }`}
                  >
                    <span className="font-space text-sm text-purple-100 truncate" title={g.group_id}>
                      {g.group_id}
                    </span>
                    <RoleBadges roles={g.roles} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      <div className="w-full md:flex-1 min-w-0">
        {!selected ? (
          <div className="rounded-xl border border-purple-500/30 bg-purple-900/20 p-10 text-center">
            <p className="font-space text-purple-300">
              Select a group to view its members and files.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="font-museo text-lg font-bold text-white mb-1 truncate" title={selected}>
                {selected}
              </h2>
            </div>

            {/* Members */}
            <section>
              <h3 className="font-space text-sm font-semibold text-purple-200 mb-2">Members</h3>
              {membersLoading && <Spinner label="Loading members…" />}
              {membersError && !membersLoading && (
                <ErrorRow message={membersError} onRetry={retryDetail} />
              )}
              {members && !membersLoading && !membersError && (
                members.length === 0 ? (
                  <p className="font-space text-sm text-purple-400">No members.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <li
                        key={m}
                        className="flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-900/30 px-3 py-1 text-sm text-purple-100"
                        title={m}
                      >
                        {displayName(m)}
                        {m === accountId && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-purple-600 text-white">
                            you
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </section>

            {/* Transactions */}
            <section>
              <h3 className="font-space text-sm font-semibold text-purple-200 mb-2">Files</h3>
              {txsLoading && <Spinner label="Loading files…" />}
              {txsError && !txsLoading && (
                <ErrorRow message={txsError} onRetry={retryDetail} />
              )}
              {txs && !txsLoading && !txsError && (
                txs.length === 0 ? (
                  <p className="font-space text-sm text-purple-400">No files in this group yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-purple-500/30">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-purple-900/40 text-purple-300">
                        <tr>
                          <th className="px-3 py-2 font-medium">Uploader</th>
                          <th className="px-3 py-2 font-medium">File hash</th>
                          <th className="px-3 py-2 font-medium">Backend</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {txs.map((tx) => (
                          <tr
                            key={tx.trans_id}
                            className="border-t border-purple-700/30 text-purple-100"
                          >
                            <td className="px-3 py-2 truncate" title={tx.user_id}>
                              {displayName(tx.user_id)}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-purple-300" title={tx.file_hash}>
                              {shortHash(tx.file_hash)}…
                            </td>
                            <td className="px-3 py-2">
                              <BackendBadge tx={tx} />
                            </td>
                            <td className="px-3 py-2 text-purple-300 whitespace-nowrap">
                              {formatDate(tx.timestamp)}
                            </td>
                            <td className="px-3 py-2">
                              {tx.deleted ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 border border-red-400/30 text-red-300">
                                  deleted
                                </span>
                              ) : (
                                <span className="text-purple-500 text-xs">active</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}