"use client";

// Admin → SmugMug import — post-triage-refactor edit.
//
// Migration 26 dropped the reviewer queue (`photos.priority`,
// `photos.current_status`, `smugmug_config.queue_order`) and the
// /api/smugmug/{prioritize,clear-pending} routes. This screen
// accordingly drops:
//   - the Prioritize action + folder-picker modal
//   - the queue-list card and its filter pills
//   - the queue_order radio in the edit-config modal
//   - the mode-switch "keep / clear / cancel" confirm dialog
//
// What remains: a settings card (mode + the relevant date), an edit
// modal (mode + date), a Sync-now action that hits the existing
// /api/smugmug/sync-now endpoint, and the sync log table. The
// `mode` knob and the `smugmug_mode` enum survive as a placeholder
// for the future quality-review spec — no current code consumes the
// summer/off-season distinction beyond picking the relevant date
// column, but the surface stays so the future spec doesn't have to
// recreate it.

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  fetchSmugmugConfig,
  updateSmugmugConfig,
  type SmugmugConfig,
  type SmugmugMode,
} from "@/lib/smugmug-config";
import {
  fetchRecentSyncLog,
  type SyncLogRow,
  type SyncKind,
  type SyncStatus,
} from "@/lib/sync-log";

// ─────────────────────────────────────────────────────────────────────────────
// Top-level layout
// ─────────────────────────────────────────────────────────────────────────────

export function SmugMugImport({ toast }: { toast?: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [config, setConfig] = React.useState<SmugmugConfig | null>(null);
  const [configError, setConfigError] = React.useState<string | null>(null);
  // Bumped after any action (config edit, sync now) so the log card
  // refetches without per-card prop drilling.
  const [refreshTick, setRefreshTick] = React.useState(0);
  const bumpRefresh = React.useCallback(() => setRefreshTick((t) => t + 1), []);

  const reloadConfig = React.useCallback(() => {
    fetchSmugmugConfig(supabase)
      .then((row) => setConfig(row))
      .catch((err) => {
        console.error("[admin-smugmug] config fetch failed:", err);
        setConfigError(err?.message ?? "Failed to load smugmug_config");
      });
  }, [supabase]);

  React.useEffect(() => {
    reloadConfig();
  }, [reloadConfig, refreshTick]);

  return (
    <>
      <PageHeader
        eyebrow="Admin · SmugMug import"
        title="SmugMug <em>import.</em>"
        sub="Settings and sync log for the SmugMug ingestion pipeline."
      />

      {configError && (
        <div className="page-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <ErrorBanner>Couldn&apos;t load config: {configError}</ErrorBanner>
        </div>
      )}

      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <SettingsCard
            config={config}
            onSaved={(next) => {
              setConfig(next);
              bumpRefresh();
            }}
            toast={toast}
          />
          <ActionsRow onSyncDone={bumpRefresh} toast={toast} />
        </div>

        <SyncLogCard refreshTick={refreshTick} />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings card
// ─────────────────────────────────────────────────────────────────────────────

function SettingsCard({
  config,
  onSaved,
  toast,
}: {
  config: SmugmugConfig | null;
  onSaved: (next: SmugmugConfig) => void;
  toast?: ToastApi;
}) {
  const [editing, setEditing] = React.useState(false);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h3 className="card-title">Sync settings</h3>
        <button
          className="btn btn-ghost"
          onClick={() => setEditing(true)}
          disabled={!config}
          style={{ opacity: config ? 1 : 0.5 }}
        >
          Edit
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Controls which camp_weeks the scheduled sync pulls photos from.
      </div>

      {!config ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <SettingsRow label="Mode" value={modeLabel(config.mode)} />
          <SettingsRow
            label={config.mode === "summer" ? "Season start" : "Earliest fetch"}
            value={
              (config.mode === "summer"
                ? config.seasonStartDate
                : config.earliestFetchDate) ?? "— not set —"
            }
          />
          <SettingsRow
            label="Last sync"
            value={
              config.lastSyncAt
                ? `${formatRelativeFromIso(config.lastSyncAt)} · ${config.lastSyncStatus ?? "—"}`
                : "Never"
            }
          />
        </div>
      )}

      {editing && config && (
        <EditConfigModal
          config={config}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            onSaved(next);
            setEditing(false);
            toast?.show("Sync settings saved");
          }}
        />
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

// ─────────────────────────────────────────────────────────────────────────────
// Edit-config modal
// ─────────────────────────────────────────────────────────────────────────────

type EditDraft = {
  mode: SmugmugMode;
  seasonStartDate: string;
  earliestFetchDate: string;
};

function EditConfigModal({
  config,
  onClose,
  onSaved,
}: {
  config: SmugmugConfig;
  onClose: () => void;
  onSaved: (next: SmugmugConfig) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [draft, setDraft] = React.useState<EditDraft>({
    mode: config.mode,
    seasonStartDate: config.seasonStartDate ?? "",
    earliestFetchDate: config.earliestFetchDate ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty =
    draft.mode !== config.mode ||
    draft.seasonStartDate !== (config.seasonStartDate ?? "") ||
    draft.earliestFetchDate !== (config.earliestFetchDate ?? "");

  // Validate the date for the active mode is set before allowing save.
  const dateOk =
    draft.mode === "summer"     ? !!draft.seasonStartDate :
    !!draft.earliestFetchDate;

  const onSaveClick = async () => {
    if (saving || !dirty || !dateOk) return;
    setError(null);
    setSaving(true);
    try {
      const next = await updateSmugmugConfig(supabase, {
        mode: draft.mode,
        seasonStartDate: draft.seasonStartDate || null,
        earliestFetchDate: draft.earliestFetchDate || null,
      });
      onSaved(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      eyebrow="Edit sync settings"
      title="SmugMug ingestion"
      tone="lake"
      onClose={() => !saving && onClose()}
    >
      <div style={{ display: "grid", gap: 16, marginBottom: 18 }}>
        <Fieldset label="Mode">
          <RadioRow>
            <Radio
              checked={draft.mode === "summer"}
              onChange={() => setDraft((d) => ({ ...d, mode: "summer" }))}
              label="Summer"
              hint="Active-season fast window — pull weeks from season start onward."
            />
            <Radio
              checked={draft.mode === "off_season"}
              onChange={() => setDraft((d) => ({ ...d, mode: "off_season" }))}
              label="Off-season"
              hint="Archival cleanup — pull weeks from earliest-fetch date onward."
            />
          </RadioRow>
        </Fieldset>

        {draft.mode === "summer" ? (
          <Fieldset label="Season start date" hint="First day of camp for this season. Only weeks with starts_on >= this date are synced.">
            <input
              type="date"
              className="input"
              value={draft.seasonStartDate}
              onChange={(e) => setDraft((d) => ({ ...d, seasonStartDate: e.target.value }))}
            />
          </Fieldset>
        ) : (
          <Fieldset label="Earliest fetch date" hint="Lower bound for off-season archival cleanup. Only weeks with starts_on >= this date are synced.">
            <input
              type="date"
              className="input"
              value={draft.earliestFetchDate}
              onChange={(e) => setDraft((d) => ({ ...d, earliestFetchDate: e.target.value }))}
            />
          </Fieldset>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button className="btn btn-ghost" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!dirty || !dateOk || saving}
          onClick={onSaveClick}
          style={{ opacity: dirty && dateOk && !saving ? 1 : 0.5 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions row — sync now only (Prioritize + its folder picker are gone)
// ─────────────────────────────────────────────────────────────────────────────

function ActionsRow({
  onSyncDone,
  toast,
}: {
  onSyncDone: () => void;
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
        const msg = body?.message ?? body?.error ?? `sync-now failed (${res.status})`;
        throw new Error(msg);
      }
      const summary = `+${body.photosAdded ?? 0} ~${body.photosUpdated ?? 0} -${body.photosRemoved ?? 0}`;
      toast?.show(`Sync complete · ${summary}`);
      onSyncDone();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncError(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: 4 }}>Actions</h3>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Trigger an off-schedule sync against the currently configured mode + date.
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

// ─────────────────────────────────────────────────────────────────────────────
// Sync log card
// ─────────────────────────────────────────────────────────────────────────────

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
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                          +{row.photosAdded} ~{row.photosUpdated} -{row.photosRemoved}
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

function KindPill({ kind }: { kind: SyncKind }) {
  // `mode_switch` and `priority_add` came out of the enum in migration 26
  // along with their producer routes; `triage_sample` was added
  // proactively for Step 3's sample-burst cron.
  const label =
    kind === "scheduled"       ? "Scheduled"  :
    kind === "manual"          ? "Manual"     :
    kind === "quarantine_move" ? "Quarantine" :
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const th: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--rule)", fontWeight: 500 };
const td: React.CSSProperties = { padding: "10px", verticalAlign: "top" };

function ModalShell({
  title,
  eyebrow,
  tone,
  width = 520,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  tone: "moss" | "rose" | "sun" | "lake";
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const toneVar =
    tone === "moss" ? "var(--moss)" :
    tone === "rose" ? "var(--rose)" :
    tone === "sun"  ? "var(--sun)"  : "var(--lake)";
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20, 25, 30, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width,
          background: "var(--paper)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: 24,
          maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: toneVar, marginBottom: 4,
          }}>{eyebrow}</div>
          <h2 style={{
            fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
            letterSpacing: "-0.02em", margin: 0,
          }}>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function Fieldset({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="label" style={{ marginBottom: 0 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

function RadioRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 8 }}>{children}</div>;
}

function Radio({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label style={{
      display: "grid", gridTemplateColumns: "auto 1fr", gap: 10,
      padding: "10px 12px", borderRadius: 8,
      border: `1px solid ${checked ? "var(--ink)" : "var(--rule)"}`,
      background: checked ? "var(--paper)" : "transparent",
      cursor: "pointer",
    }}>
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        style={{ alignSelf: "start", marginTop: 4 }}
      />
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>{hint}</div>}
      </div>
    </label>
  );
}

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

function modeLabel(m: SmugmugMode): string {
  return m === "summer" ? "Summer" : "Off-season";
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

// Rough relative time for the sync-log "Yesterday 4:02am" feel. Falls
// back to a short absolute string for anything older than a week.
function formatRelativeFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
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
