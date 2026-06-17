"use client";

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  fetchLatestSyncSummary,
  fetchRecentSyncLog,
  formatSyncCompleteToast,
  formatSyncLogCounts,
  type LatestSyncSummary,
  type SyncLogRow,
  type SyncKind,
  type SyncStatus,
} from "@/lib/sync-log";

export function SmugMugImport({ toast }: { toast?: ToastApi }) {
  const [refreshTick, setRefreshTick] = React.useState(0);
  const bumpRefresh = React.useCallback(() => setRefreshTick((t) => t + 1), []);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Photo sync"
        title="Photo <em>sync.</em>"
        sub="SmugMug ingestion log and maintenance actions. Season dates live in App settings."
      />

      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <DivisionsCard toast={toast} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <LastSyncCard refreshTick={refreshTick} />
          <ActionsCard onDone={bumpRefresh} toast={toast} />
        </div>
        <SyncLogCard refreshTick={refreshTick} />
      </div>
    </>
  );
}

function LastSyncCard({ refreshTick }: { refreshTick: number }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [summary, setSummary] = React.useState<LatestSyncSummary | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchLatestSyncSummary(supabase)
      .then((row) => { if (!cancelled) setSummary(row); })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load last sync");
          setSummary(null);
        }
      });
    return () => { cancelled = true; };
  }, [supabase, refreshTick]);

  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}>Last sync</h3>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        From the most recent row in sync_log.
      </div>
      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}
      {summary === undefined && !loadError && (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>
      )}
      {summary === null && !loadError && (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No sync runs yet.</div>
      )}
      {summary && (
        <div style={{ display: "grid", gap: 8 }}>
          <SettingsRow label="Started" value={formatDateTimeShort(summary.startedAt)} />
          <SettingsRow
            label="Status"
            value={summary.finishedAt === null ? "in flight" : summary.summaryLine}
          />
        </div>
      )}
    </div>
  );
}

type DivisionRow = {
  smugmugNodeId: string;
  name: string;
  type: string;
  inDb: boolean;
  dbId: string | null;
  isPlaceholder: boolean;
  matchKind: "by_id" | "by_name" | null;
  synced: boolean;
};

function DivisionsCard({ toast }: { toast?: ToastApi }) {
  // undefined = loading, null = error/empty
  const [divisions, setDivisions] = React.useState<DivisionRow[] | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [collapsed, setCollapsed] = React.useState(true);

  // One-line summary shown in the collapsed header.
  const summary = React.useMemo(() => {
    if (divisions === undefined) return "Loading…";
    if (divisions === null) return "Failed to load";
    const syncedNames = divisions.filter((d) => d.synced).map((d) => d.name);
    if (syncedNames.length === 0) return `0 of ${divisions.length} synced`;
    return `${syncedNames.length} of ${divisions.length} synced · ${syncedNames.join(", ")}`;
  }, [divisions]);

  React.useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetch("/api/smugmug/sync-folders")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) {
          throw new Error(body?.message ?? body?.error ?? `Failed to load divisions (${res.status})`);
        }
        return body.divisions as DivisionRow[];
      })
      .then((rows) => {
        if (cancelled) return;
        setDivisions((rows ?? []).filter((d) => d.type === "Folder"));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load divisions");
        setDivisions(null);
      });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const onToggle = async (row: DivisionRow, next: boolean) => {
    if (busyId || !row.inDb || !row.dbId) return;
    setBusyId(row.dbId);
    setRowError(null);
    // Optimistic update.
    setDivisions((prev) =>
      prev && prev !== undefined
        ? prev.map((d) => (d.dbId === row.dbId ? { ...d, synced: next } : d))
        : prev
    );
    try {
      const res = await fetch("/api/smugmug/sync-folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ divisionId: row.dbId, synced: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message ?? body?.error ?? `Update failed (${res.status})`);
      }
      if (next) {
        toast?.show(`${row.name} enabled — run “Sync now” to pull its photos.`);
      }
    } catch (err: unknown) {
      // Revert.
      setDivisions((prev) =>
        prev && prev !== undefined
          ? prev.map((d) => (d.dbId === row.dbId ? { ...d, synced: !next } : d))
          : prev
      );
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        style={{
          all: "unset",
          boxSizing: "border-box",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            transform: collapsed ? "rotate(-90deg)" : "none",
            transition: "transform .15s",
          }}
        >
          ▾
        </span>
        <h3 className="card-title" style={{ margin: 0 }}>Divisions</h3>
        {collapsed && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {summary}
          </span>
        )}
      </button>
      {!collapsed && (
        <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Top-level SmugMug folders. Toggle which divisions feed the photo pipeline —
        only enabled ones get their locations, weeks, and photos synced.
      </div>
      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}
      {rowError && <ErrorBanner>{rowError}</ErrorBanner>}
      {divisions === undefined && !loadError && (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>
      )}
      {divisions !== undefined && divisions !== null && divisions.length === 0 && !loadError && (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No divisions found under the SmugMug account.</div>
      )}
      {divisions && divisions.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {divisions.map((row) => {
            const disabled = !row.inDb || !row.dbId || busyId !== null;
            return (
              <div
                key={row.smugmugNodeId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <div>
                  <div style={{ fontSize: 14 }}>{row.name}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {!row.inDb && (
                      <span className="pill pill-sun" style={{ fontSize: 10 }}>
                        run Sync now to register
                      </span>
                    )}
                    {row.isPlaceholder && (
                      <span className="pill" style={{ fontSize: 10 }}>placeholder</span>
                    )}
                    {row.synced ? (
                      <span className="pill pill-moss" style={{ fontSize: 10 }}>synced</span>
                    ) : (
                      <span className="pill" style={{ fontSize: 10 }}>not synced</span>
                    )}
                  </div>
                </div>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--ink-3)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.synced}
                    disabled={disabled}
                    onChange={(e) => onToggle(row, e.target.checked)}
                  />
                  Sync
                </label>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() => setRefreshTick((t) => t + 1)}
          disabled={divisions === undefined}
          style={{ fontSize: 12 }}
        >
          Refresh
        </button>
      </div>
        </div>
      )}
    </div>
  );
}

function ActionsCard({
  onDone,
  toast,
}: {
  onDone: () => void;
  toast?: ToastApi;
}) {
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const onSyncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/smugmug/sync-now", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        const missing =
          Array.isArray(body?.missing) && body.missing.length > 0
            ? ` Missing on server: ${body.missing.join(", ")}.`
            : "";
        const msg =
          body?.message ??
          body?.errorSummary ??
          body?.error ??
          `sync-now failed (${res.status})`;
        throw new Error(`${msg}${missing}`);
      }
      if (body?.status === "failed") {
        throw new Error(body?.errorSummary ?? "Sync failed");
      }
      toast?.show(formatSyncCompleteToast({
        kind: "manual",
        weeksInScope: body.weeksInScope ?? body.scope?.weekCount ?? null,
        imagesSeen: body.imagesSeen ?? null,
        photosAdded: body.photosAdded ?? body.photos_added ?? 0,
        photosUpdated: body.photosUpdated ?? body.photos_updated ?? 0,
        photosRemoved: body.photosRemoved ?? body.photos_removed ?? 0,
      }));
      onDone();
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}>Actions</h3>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Manual sync. Season cutoff comes from App settings.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          onClick={onSyncNow}
          disabled={syncing}
          style={{ opacity: syncing ? 0.6 : 1 }}
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {syncError && (
        <div style={{ marginTop: 12 }}>
          <ErrorBanner>{syncError}</ErrorBanner>
        </div>
      )}
    </div>
  );
}

function SyncLogCard({ refreshTick }: { refreshTick: number }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [rows, setRows] = React.useState<SyncLogRow[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let cancelled = false;
    fetchRecentSyncLog(supabase, 20)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load sync log");
          setRows([]);
        }
      });
    return () => { cancelled = true; };
  }, [supabase, refreshTick]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}>Sync log</h3>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Last 20 sync runs. Click a row to expand error details when status is partial or failed.
      </div>
      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}
      {rows === null ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>No sync runs yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ink-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={th}>When</th>
                <th style={th}>Kind</th>
                <th style={th}>Status</th>
                <th style={th}>Counts</th>
                <th style={th}>Triggered by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expandable = !!row.errorSummary;
                const isOpen = expanded.has(row.id);
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      style={{
                        borderTop: "1px solid var(--rule)",
                        cursor: expandable ? "pointer" : "default",
                      }}
                      onClick={() => { if (expandable) toggle(row.id); }}
                    >
                      <td style={td}>
                        <div style={{ fontSize: 12 }}>{formatRelativeFromIso(row.startedAt)}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {formatDateTimeShort(row.startedAt)}
                        </div>
                      </td>
                      <td style={td}><KindPill kind={row.kind} /></td>
                      <td style={td}><SyncStatusPill status={row.status} finished={row.finishedAt !== null} /></td>
                      <td style={td}>
                        <span style={{ fontSize: 12 }}>
                          {formatSyncLogCounts(row)}
                        </span>
                      </td>
                      <td style={td}>
                        <div style={{ fontSize: 12 }}>{row.triggeredByName ?? "Cron"}</div>
                        {row.triggeredByEmail && (
                          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{row.triggeredByEmail}</div>
                        )}
                      </td>
                    </tr>
                    {expandable && isOpen && (
                      <tr style={{ background: "var(--paper-2)" }}>
                        <td colSpan={5} style={{ padding: "10px 14px", fontSize: 12, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
                          {row.errorSummary}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto 1fr",
      gap: 12, alignItems: "baseline",
      paddingBottom: 8, borderBottom: "1px solid var(--rule)",
    }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11,
        letterSpacing: "0.08em", textTransform: "uppercase",
        color: "var(--ink-3)",
      }}>{label}</div>
      <div style={{ fontSize: 14 }}>{value}</div>
    </div>
  );
}

function KindPill({ kind }: { kind: SyncKind }) {
  const label =
    kind === "scheduled"       ? "Scheduled"  :
    kind === "manual"          ? "Manual"     :
    kind === "quarantine_move" ? "Hidden"     :
    kind === "triage_sample"   ? "Sample"     :
    "Other";
  const cls =
    kind === "scheduled"       ? "pill pill-lake" :
    kind === "manual"          ? "pill pill-moss" :
    kind === "quarantine_move" ? "pill pill-rose" :
    kind === "triage_sample"   ? "pill pill-sun"  :
    "pill";
  return <span className={cls}>{label}</span>;
}

function SyncStatusPill({ status, finished }: { status: SyncStatus; finished: boolean }) {
  if (!finished) return <span className="pill">in flight</span>;
  if (status === "success") return <span className="pill pill-moss">success</span>;
  if (status === "partial") return <span className="pill pill-sun">partial</span>;
  return <span className="pill pill-rose">failed</span>;
}

const th: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--rule)", fontWeight: 500 };
const td: React.CSSProperties = { padding: "10px", verticalAlign: "top" };

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: 10, marginBottom: 12,
      border: "1px solid var(--rose)", borderRadius: 6,
      background: "var(--rose-soft)", color: "var(--rose)",
      fontSize: 12,
    }}>{children}</div>
  );
}

function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatRelativeFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.round(diffMs / 60_000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

