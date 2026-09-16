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

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, ShieldCheck, ShieldAlert, Download, ChevronDown, ChevronRight } from 'lucide-react';
import {
  loadGroups,
  loadGroupMembers,
  loadGroupTransactions,
  prepareRetrieve,
  DashboardFetchError,
  type GroupSummary,
  type Transaction,
} from '@/lib/dashboard-client';
import { decodeFile, sha256Hex, NovaDecodeError, type FileFormat } from '@/lib/nova-decode';

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

// DeletionReason enum → human label (the regulator-facing wording).
function reasonLabel(reason: string): string {
  switch (reason) {
    case 'MemberRevocation': return 'Member revoked';
    case 'OwnerRequest': return 'Owner request';
    case 'RetentionPolicy': return 'Retention policy';
    case 'ComplianceRequest': return 'Compliance request';
    default: return reason; // unknown future enum value — show it raw, don't hide it
  }
}

function errMessage(e: unknown): string {
  if (e instanceof DashboardFetchError) return e.message;
  if (e instanceof NovaDecodeError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

// Best-effort type/extension sniff from magic bytes (mirrors ChatInterface's
// detectMimeType). The original filename/content-type isn't returned by
// prepare_retrieve, so we infer for the download name; unknown → .bin (honest).
function sniffExt(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 1000));
    return 'txt';
  } catch {
    return 'bin';
  }
}

// Per-file verify/decrypt outcome, keyed by trans_id.
type VerifyState =
  | { status: 'verifying' }
  | { status: 'verified'; match: boolean; bytes: Uint8Array; ext: string }
  | { status: 'error'; message: string; walletUnavailable: boolean };

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
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-900/40 border border-purple-500/30 text-white">
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

// Permanent, non-retryable notice for the wallet + private-group read gap
// (§5.11-B). Distinct from ErrorRow: no Retry (retrying can't help), calmer tone.
function WalletUnavailableNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-purple-500/30 bg-purple-900/30 px-3 py-2 text-sm text-purple-300">
      <AlertCircle size={16} className="shrink-0 mt-0.5 text-purple-400" />
      <span>Private-group details aren&apos;t available for wallet sign-in — coming with client-side signing.</span>
    </div>
  );
}

// ── integrity cell (per file row): Verify → decode+hash → pill (+ download) ────

function IntegrityCell({
  tx,
  state,
  onVerify,
  onDownload,
}: {
  tx: Transaction;
  state: VerifyState | undefined;
  onVerify: () => void;
  onDownload: (tx: Transaction, bytes: Uint8Array, ext: string) => void;
}) {
  // A tombstoned file has no retrievable ciphertext — don't offer verify.
  if (tx.deleted) {
    return <span className="text-purple-600 text-xs">—</span>;
  }

  if (!state) {
    return (
      <button
        type="button"
        onClick={onVerify}
        className="px-2.5 py-1 rounded-md text-xs font-medium bg-purple-600/80 hover:bg-purple-600 text-white transition-colors"
      >
        Verify
      </button>
    );
  }

  if (state.status === 'verifying') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-purple-300">
        <Loader2 size={13} className="animate-spin" /> Verifying…
      </span>
    );
  }

  if (state.status === 'error') {
    // The wallet + private-group gap (same as members/files sections): retry
    // won't help, so show the calm notice, not a retry.
    if (state.walletUnavailable) {
      return (
        <span className="text-xs text-purple-400" title="Coming with client-side signing">
          Unavailable on wallet
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-300" title={state.message}>
        <AlertCircle size={13} /> Failed
        <button type="button" onClick={onVerify} className="underline hover:text-white">retry</button>
      </span>
    );
  }

  // verified — the integrity pill (dot + word), matching the network-pill style.
  return (
    <span className="flex items-center gap-2">
      {state.match ? (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-green-500/20 text-green-300 border border-green-500/50">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          byte-identical
        </span>
      ) : (
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-red-500/20 text-red-300 border border-red-500/50">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          byte-mismatched
        </span>
      )}
      <button
        type="button"
        onClick={() => onDownload(tx, state.bytes, state.ext)}
        title="Download decrypted file"
        className="text-purple-300 hover:text-white transition-colors"
      >
        <Download size={14} />
      </button>
    </span>
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
  const [membersWalletUnavailable, setMembersWalletUnavailable] = useState(false);

  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [txsLoading, setTxsLoading] = useState(false);
  const [txsError, setTxsError] = useState<string | null>(null);
  const [txsWalletUnavailable, setTxsWalletUnavailable] = useState(false);

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

    setMembers(null); setMembersError(null); setMembersWalletUnavailable(false); setMembersLoading(true);
    setTxs(null); setTxsError(null); setTxsWalletUnavailable(false); setTxsLoading(true);
    setVerify({}); // drop any decrypted bytes from the previously-selected group
    setExpanded({});

    loadGroupMembers(selected)
      .then((m) => { if (!cancelled) { setMembers(m); setMembersLoading(false); } })
      .catch((e) => {
        if (cancelled) return;
        setMembersWalletUnavailable(e instanceof DashboardFetchError && e.walletSignerUnavailable);
        setMembersError(errMessage(e));
        setMembersLoading(false);
      });

    loadGroupTransactions(selected)
      .then((t) => { if (!cancelled) { setTxs(t); setTxsLoading(false); } })
      .catch((e) => {
        if (cancelled) return;
        setTxsWalletUnavailable(e instanceof DashboardFetchError && e.walletSignerUnavailable);
        setTxsError(errMessage(e));
        setTxsLoading(false);
      });

    return () => { cancelled = true; };
  }, [selected, detailReloadKey]);

  const retryDetail = () => setDetailReloadKey((k) => k + 1);

  // Per-file verify state, keyed by trans_id. Cleared when the selected group
  // changes (below) so no decrypted bytes linger across groups.
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});

  // Which deleted rows have their audit detail expanded (keyed by trans_id).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) =>
    setExpanded((e) => ({ ...e, [id]: !e[id] }));

  // Retrieve → decode (browser) → hash → compare to the on-chain file_hash.
  // Plaintext and key never leave the browser; the server only brokered the
  // ciphertext + wrapped key.
  const verifyFile = useCallback(async (tx: Transaction) => {
    setVerify((v) => ({ ...v, [tx.trans_id]: { status: 'verifying' } }));
    try {
      const { key, encrypted_b64, format } = await prepareRetrieve(tx.group_id, tx.ipfs_hash);
      const plaintext = await decodeFile(encrypted_b64, key, format as FileFormat | null);
      const recomputed = await sha256Hex(plaintext);
      const match = recomputed.toLowerCase() === tx.file_hash.toLowerCase();
      setVerify((v) => ({
        ...v,
        [tx.trans_id]: { status: 'verified', match, bytes: plaintext, ext: sniffExt(plaintext) },
      }));
    } catch (e) {
      const walletUnavailable = e instanceof DashboardFetchError && e.walletSignerUnavailable;
      setVerify((v) => ({
        ...v,
        [tx.trans_id]: { status: 'error', message: errMessage(e), walletUnavailable },
      }));
    }
  }, []);

  // Download decrypted bytes (already in memory from a successful verify).
  const downloadFile = useCallback((tx: Transaction, bytes: Uint8Array, ext: string) => {
    const copy = bytes.slice();
    const blob = new Blob([copy], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-${tx.trans_id.slice(0, 8)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Split each section's error into the wallet-gap notice (no retry) vs a genuine
  // retryable error, so the JSX stays readable.
  const membersErrorInfo = {
    walletUnavailable: !!membersError && membersWalletUnavailable,
    showError: !!membersError && !membersWalletUnavailable,
  };
  const txsErrorInfo = {
    walletUnavailable: !!txsError && txsWalletUnavailable,
    showError: !!txsError && !txsWalletUnavailable,
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* ── Group list ─────────────────────────────────────────────────────── */}
      <div className="w-full md:w-1/3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-museo text-lg font-bold text-nova-text">Groups</h2>
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
                    <span className="font-space text-sm text-nova-text truncate" title={g.group_id}>
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
            <p className="font-space text-nova-text-dim">
              Select a group to view its members and files.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="font-museo text-lg font-bold text-nova-text mb-1 truncate" title={selected}>
                {selected}
              </h2>
            </div>

            {/* Members */}
            <section>
              <h3 className="font-space text-sm font-semibold text-nova-purple mb-2">Members</h3>
              {membersLoading && <Spinner label="Loading members…" />}
              {membersErrorInfo.walletUnavailable && !membersLoading && (
                <WalletUnavailableNotice />
              )}
              {membersErrorInfo.showError && !membersLoading && (
                <ErrorRow message={membersError!} onRetry={retryDetail} />
              )}
              {members && !membersLoading && !membersError && (
                members.length === 0 ? (
                  <p className="font-space text-sm text-purple-400">No members.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <li
                        key={m}
                        className="flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-900/30 px-3 py-1 text-sm text-nova-text"
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
              <h3 className="font-space text-sm font-semibold text-nova-purple mb-2">Files</h3>
              {txsLoading && <Spinner label="Loading files…" />}
              {txsErrorInfo.walletUnavailable && !txsLoading && (
                <WalletUnavailableNotice />
              )}
              {txsErrorInfo.showError && !txsLoading && (
                <ErrorRow message={txsError!} onRetry={retryDetail} />
              )}
              {txs && !txsLoading && !txsError && (
                txs.length === 0 ? (
                  <p className="font-space text-sm text-purple-400">No files in this group yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-purple-500/30">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-nova-surface-2 text-nova-purple">
                        <tr>
                          <th className="px-3 py-2 font-medium">Uploader</th>
                          <th className="px-3 py-2 font-medium">File hash</th>
                          <th className="px-3 py-2 font-medium">Backend</th>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Integrity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {txs.map((tx) => (
                          <Fragment key={tx.trans_id}>
                          <tr
                            className="border-t border-purple-700/30 text-purple-100"
                          >
                            <td className="px-3 py-2 truncate text-nova-purple" title={tx.user_id}>
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
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(tx.trans_id)}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 transition-colors"
                                  title="Show deletion details"
                                  aria-expanded={!!expanded[tx.trans_id]}
                                >
                                  {expanded[tx.trans_id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                  deleted
                                </button>
                              ) : (
                                <span className="text-purple-500 text-xs">active</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <IntegrityCell
                                tx={tx}
                                state={verify[tx.trans_id]}
                                onVerify={() => verifyFile(tx)}
                                onDownload={downloadFile}
                              />
                            </td>
                          </tr>
                          {tx.deleted && expanded[tx.trans_id] && (
                            <tr className="bg-red-950/20">
                              <td colSpan={6} className="px-3 py-3 border-t border-red-700/20">
                                <div className="flex flex-col gap-1.5 text-xs text-purple-200">
                                  <div className="font-semibold text-red-300 mb-0.5">Deletion record</div>
                                  <div className="flex flex-wrap gap-x-8 gap-y-1.5">
                                    <span><span className="text-purple-400">Reason: </span>{reasonLabel(tx.deleted.reason)}</span>
                                    <span><span className="text-purple-400">Deleted by: </span><span title={tx.deleted.deleted_by}>{displayName(tx.deleted.deleted_by)}</span></span>
                                    <span><span className="text-purple-400">Deleted at: </span>{formatDate(tx.deleted.deleted_at)}</span>
                                    <span><span className="text-purple-400">Uploaded: </span>{formatDate(tx.timestamp)}</span>
                                  </div>
                                  <div className="text-purple-500 mt-1">
                                    The encrypted content and its key were destroyed; this on-chain record is retained as a permanent, tamper-evident audit entry.
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
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