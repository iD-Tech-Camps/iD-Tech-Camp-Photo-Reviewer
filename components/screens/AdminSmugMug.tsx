"use client";

// Step 8.5 — Admin → SmugMug screen.
//
// Replaces the static placeholder with the real operational dashboard:
//   - Settings card (mode, dates, queue order, last-sync line)
//   - Edit-config modal with mode-switch keep/clear/cancel dialog
//   - Actions row: Sync now (8.4 manual endpoint) + Prioritize in queue
//   - Folder picker tree (DB-backed: divisions where synced=true → locations → camp_weeks)
//   - Paginated queue list with all/priority/recent filters
//   - Sync log table (last 20 rows, expandable error details)
//
// Co-located in one file so the routing surface in App.tsx stays tiny —
// `Admin.tsx` re-exports `SmugMugImport` from here. The pieces are
// kept as named exports so they can be tested in isolation later.

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  fetchSmugmugConfig,
  updateSmugmugConfig,
  type SmugmugConfig,
  type SmugmugMode,
  type QueueOrder,
} from "@/lib/smugmug-config";
import {
  fetchQueueList,
  fetchPendingWithoutReviewCount,
  type QueueRow,
  type QueueFilter,
} from "@/lib/queue-list";
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
  // Bumped after any action (config edit, sync now, prioritize, clear)
  // so the queue/log cards refetch without per-card prop drilling.
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
        sub="Settings, sync, and queue priority for the SmugMug ingestion pipeline."
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
            onClearedQueue={bumpRefresh}
            toast={toast}
          />
          <ActionsRow
            onSyncDone={bumpRefresh}
            onPrioritizeDone={bumpRefresh}
            toast={toast}
          />
        </div>

        <QueueListCard
          queueOrder={config?.queueOrder ?? "newest_first"}
          refreshTick={refreshTick}
        />

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
  onClearedQueue,
  toast,
}: {
  config: SmugmugConfig | null;
  onSaved: (next: SmugmugConfig) => void;
  onClearedQueue: () => void;
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
          <SettingsRow label="Queue order" value={queueOrderLabel(config.queueOrder)} />
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
          onClearedQueue={() => {
            onClearedQueue();
            toast?.show("Pending queue cleared");
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
  queueOrder: QueueOrder;
};

function EditConfigModal({
  config,
  onClose,
  onSaved,
  onClearedQueue,
}: {
  config: SmugmugConfig;
  onClose: () => void;
  onSaved: (next: SmugmugConfig) => void;
  onClearedQueue: () => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [draft, setDraft] = React.useState<EditDraft>({
    mode: config.mode,
    seasonStartDate: config.seasonStartDate ?? "",
    earliestFetchDate: config.earliestFetchDate ?? "",
    queueOrder: config.queueOrder,
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // When mode changed and there are pending photos, the save click
  // pivots to a 3-way confirm dialog before any DB writes happen.
  const [confirming, setConfirming] = React.useState<{ pending: number } | null>(null);

  const dirty =
    draft.mode !== config.mode ||
    draft.seasonStartDate !== (config.seasonStartDate ?? "") ||
    draft.earliestFetchDate !== (config.earliestFetchDate ?? "") ||
    draft.queueOrder !== config.queueOrder;
  const modeChanged = draft.mode !== config.mode;

  // Validate the date for the active mode is set before allowing save.
  const dateOk =
    draft.mode === "summer"     ? !!draft.seasonStartDate :
    !!draft.earliestFetchDate;

  const writeConfig = React.useCallback(async () => {
    return updateSmugmugConfig(supabase, {
      mode: draft.mode,
      seasonStartDate: draft.seasonStartDate || null,
      earliestFetchDate: draft.earliestFetchDate || null,
      queueOrder: draft.queueOrder,
    });
  }, [supabase, draft]);

  const onSaveClick = async () => {
    if (saving || !dirty || !dateOk) return;
    setError(null);

    if (modeChanged) {
      // Check pending count first; only show the confirm dialog if there's
      // anything to lose. Empty queue = transparent flip.
      try {
        const pending = await fetchPendingWithoutReviewCount(supabase);
        if (pending > 0) {
          setConfirming({ pending });
          return;
        }
      } catch (err: unknown) {
        // Soft-fail — don't block the save if the count query hiccups.
        console.warn("[admin-smugmug] pending count failed:", err);
      }
    }

    setSaving(true);
    try {
      const next = await writeConfig();
      onSaved(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const onConfirmKeep = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await writeConfig();
      setConfirming(null);
      onSaved(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const onConfirmClear = async () => {
    setSaving(true);
    setError(null);
    try {
      // Order: clear first (so the audit log shows the reset BEFORE the
      // mode flip), then write config. If the clear fails, config stays
      // untouched and the dialog reports the error.
      const res = await fetch("/api/smugmug/clear-pending", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `clear-pending failed (${res.status})`);
      }
      const next = await writeConfig();
      setConfirming(null);
      onClearedQueue();
      onSaved(next);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (confirming) {
    return (
      <ModalShell
        eyebrow="Confirm mode switch"
        title="Pending photos waiting"
        tone="rose"
        onClose={() => !saving && setConfirming(null)}
      >
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 0, marginBottom: 16 }}>
          {confirming.pending} pending photo{confirming.pending === 1 ? "" : "s"} sit in the queue with no
          review history yet. Switching from {modeLabel(config.mode)} to {modeLabel(draft.mode)} mode
          changes which camp_weeks the next sync will target.
        </p>
        <div style={{
          padding: 10, borderRadius: 8, marginBottom: 18,
          background: "var(--paper-2)", border: "1px solid var(--rule)",
          fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5,
        }}>
          Clearing only deletes <b>unreviewed</b> pending photos. Anything that already has a review
          row (approved, flagged, deleted, or anything in between) is preserved untouched —
          review history is forever.
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn btn-ghost" disabled={saving} onClick={() => setConfirming(null)}>
            Cancel
          </button>
          <button className="btn btn-ghost" disabled={saving} onClick={onConfirmKeep}>
            Switch and keep pending photos
          </button>
          <button
            className="btn btn-primary"
            style={{ background: "var(--rose)" }}
            disabled={saving}
            onClick={onConfirmClear}
          >
            {saving ? "Clearing…" : `Switch and clear (${confirming.pending})`}
          </button>
        </div>
      </ModalShell>
    );
  }

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

        <Fieldset label="Queue order">
          <RadioRow>
            <Radio
              checked={draft.queueOrder === "newest_first"}
              onChange={() => setDraft((d) => ({ ...d, queueOrder: "newest_first" }))}
              label="Newest first"
              hint="Reviewers see the most recent capture time first."
            />
            <Radio
              checked={draft.queueOrder === "oldest_first"}
              onChange={() => setDraft((d) => ({ ...d, queueOrder: "oldest_first" }))}
              label="Oldest first"
              hint="Reviewers work chronologically forward through each day."
            />
          </RadioRow>
        </Fieldset>
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
          {saving ? "Saving…" : modeChanged ? "Continue…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions row
// ─────────────────────────────────────────────────────────────────────────────

function ActionsRow({
  onSyncDone,
  onPrioritizeDone,
  toast,
}: {
  onSyncDone: () => void;
  onPrioritizeDone: () => void;
  toast?: ToastApi;
}) {
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [picker, setPicker] = React.useState(false);

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
        Trigger an off-schedule sync or float a specific camp to the top of the reviewer queue.
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
        <button
          className="btn btn-ghost"
          onClick={() => setPicker(true)}
          disabled={syncing}
        >
          Prioritize in queue
        </button>
      </div>

      {syncError && (
        <div style={{ marginTop: 12 }}>
          <ErrorBanner>{syncError}</ErrorBanner>
        </div>
      )}

      {picker && (
        <PrioritizeModal
          onClose={() => setPicker(false)}
          onDone={(updated) => {
            setPicker(false);
            toast?.show(updated > 0 ? `Prioritized ${updated} photo${updated === 1 ? "" : "s"}` : "Nothing to prioritize");
            onPrioritizeDone();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Prioritize modal — DB-backed tree picker
// ─────────────────────────────────────────────────────────────────────────────

type PickerNode = { id: string; name: string; pendingCount: number };
type PickerLevel = "division" | "location" | "camp_week";

function PrioritizeModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (photosUpdated: number) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [level, setLevel] = React.useState<PickerLevel>("division");
  const [crumbs, setCrumbs] = React.useState<{ kind: PickerLevel; id: string; name: string }[]>([]);
  const [nodes, setNodes] = React.useState<PickerNode[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<PickerNode | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Resolve the parent context: top-level (no parent) → divisions;
  // last crumb division → locations under it; last crumb location →
  // camp_weeks under it. No camp_week-level drill — that IS the leaf.
  const parent = crumbs[crumbs.length - 1];

  React.useEffect(() => {
    let cancelled = false;
    setNodes(null);
    setLoadError(null);
    (async () => {
      try {
        if (level === "division") {
          const rows = await loadDivisions(supabase);
          if (!cancelled) setNodes(rows);
        } else if (level === "location") {
          if (!parent) return;
          const rows = await loadLocations(supabase, parent.id);
          if (!cancelled) setNodes(rows);
        } else {
          if (!parent) return;
          const rows = await loadCampWeeks(supabase, parent.id);
          if (!cancelled) setNodes(rows);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setLoadError(msg);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, level, parent]);

  const onPick = (node: PickerNode) => {
    if (level === "division") {
      setCrumbs([{ kind: "division", id: node.id, name: node.name }]);
      setLevel("location");
    } else if (level === "location") {
      setCrumbs((c) => [...c, { kind: "location", id: node.id, name: node.name }]);
      setLevel("camp_week");
    } else {
      // camp_week leaf — open confirm
      setConfirm(node);
    }
  };

  const onPrioritizeAggregate = (node: PickerNode) => setConfirm(node);

  const breadcrumbBack = (toIndex: number) => {
    // toIndex < 0 means back to root (divisions)
    if (toIndex < 0) {
      setCrumbs([]);
      setLevel("division");
    } else {
      const trimmed = crumbs.slice(0, toIndex + 1);
      setCrumbs(trimmed);
      setLevel(trimmed[trimmed.length - 1].kind === "division" ? "location" : "camp_week");
    }
    setConfirm(null);
  };

  const submit = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      const scope: PickerLevel = level;
      const res = await fetch("/api/smugmug/prioritize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, id: confirm.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message ?? body?.error ?? `prioritize failed (${res.status})`);
      }
      onDone(body.photosUpdated ?? 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      eyebrow="Prioritize in queue"
      title={confirm ? "Confirm priority bump" : "Pick a folder"}
      tone="sun"
      width={620}
      onClose={() => !busy && onClose()}
    >
      {!confirm && (
        <>
          <BreadcrumbBar crumbs={crumbs} onBack={breadcrumbBack} />
          {loadError && <ErrorBanner>{loadError}</ErrorBanner>}

          {nodes === null ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "20px 4px" }}>Loading…</div>
          ) : nodes.length === 0 ? (
            <div style={{
              padding: 20, textAlign: "center", borderRadius: 8,
              border: "1px dashed var(--rule-2)",
              fontSize: 13, color: "var(--ink-3)",
            }}>
              {level === "division"
                ? "No synced divisions. Run the folder-tree sync from the API first."
                : level === "location"
                  ? "No locations under this division yet."
                  : "No camp weeks under this location yet."}
            </div>
          ) : (
            <div style={{
              maxHeight: 360, overflowY: "auto",
              border: "1px solid var(--rule)", borderRadius: 8,
            }}>
              {nodes.map((n, i) => (
                <PickerRow
                  key={n.id}
                  node={n}
                  level={level}
                  isLast={i === nodes.length - 1}
                  onDrill={() => onPick(n)}
                  onPrioritize={() => onPrioritizeAggregate(n)}
                />
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </>
      )}

      {confirm && (
        <>
          <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 0, marginBottom: 16 }}>
            Set <code>priority = 1</code> on every pending photo under{" "}
            <b>{confirm.name}</b> ({confirm.pendingCount} pending photo
            {confirm.pendingCount === 1 ? "" : "s"})? Those photos will jump to the top of the
            reviewer queue immediately.
          </p>
          <div style={{
            padding: 10, borderRadius: 8, marginBottom: 18,
            background: "var(--paper-2)", border: "1px solid var(--rule)",
            fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5,
          }}>
            V1 has no per-row unprioritize — the only reset path is the mode-switch
            &quot;clear the queue&quot; dialog, which deletes all unreviewed pending photos.
            Photos with reviews are preserved either way.
          </div>
          {loadError && <ErrorBanner>{loadError}</ErrorBanner>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirm(null)}>
              Back
            </button>
            <button
              className="btn btn-primary"
              style={{ background: "var(--sun)", color: "var(--ink)" }}
              disabled={busy}
              onClick={submit}
            >
              {busy ? "Prioritizing…" : "Prioritize"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function BreadcrumbBar({
  crumbs,
  onBack,
}: {
  crumbs: { kind: PickerLevel; id: string; name: string }[];
  onBack: (toIndex: number) => void;
}) {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
      fontSize: 12, color: "var(--ink-3)", marginBottom: 12,
    }}>
      <button
        type="button"
        onClick={() => onBack(-1)}
        style={{
          background: "none", border: "none", padding: 0,
          color: crumbs.length === 0 ? "var(--ink)" : "var(--lake)",
          cursor: crumbs.length === 0 ? "default" : "pointer",
          fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
          fontSize: 12,
        }}
      >
        Divisions
      </button>
      {crumbs.map((c, i) => (
        <React.Fragment key={c.id}>
          <span>›</span>
          <button
            type="button"
            onClick={() => onBack(i)}
            style={{
              background: "none", border: "none", padding: 0,
              color: i === crumbs.length - 1 ? "var(--ink)" : "var(--lake)",
              cursor: i === crumbs.length - 1 ? "default" : "pointer",
              fontSize: 12,
            }}
          >
            {c.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function PickerRow({
  node,
  level,
  isLast,
  onDrill,
  onPrioritize,
}: {
  node: PickerNode;
  level: PickerLevel;
  isLast: boolean;
  onDrill: () => void;
  onPrioritize: () => void;
}) {
  // For aggregate levels (division / location), let the admin either
  // drill in or prioritize the whole subtree. For camp_weeks (the leaf),
  // there's nothing deeper — drill === prioritize.
  const isLeaf = level === "camp_week";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10,
      alignItems: "center", padding: "10px 14px",
      borderBottom: isLast ? "none" : "1px solid var(--rule)",
      background: "var(--paper)",
    }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 14 }}>{node.name}</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {node.pendingCount} pending photo{node.pendingCount === 1 ? "" : "s"}
        </div>
      </div>
      {!isLeaf && (
        <button
          className="btn btn-ghost"
          style={{ padding: "4px 10px", fontSize: 12 }}
          onClick={onPrioritize}
          disabled={node.pendingCount === 0}
          title={node.pendingCount === 0 ? "No pending photos to prioritize" : "Prioritize this entire folder"}
        >
          Prioritize all
        </button>
      )}
      <button
        className="btn btn-ghost"
        style={{ padding: "4px 10px", fontSize: 12 }}
        onClick={onDrill}
        disabled={isLeaf && node.pendingCount === 0}
      >
        {isLeaf ? "Prioritize" : "Open ›"}
      </button>
    </div>
  );
}

// ─── Picker data loaders ─────────────────────────────────────────────────────

async function loadDivisions(supabase: ReturnType<typeof createClient>): Promise<PickerNode[]> {
  // Only synced divisions are pickable — that's the gate the deep folder
  // walker uses, and we want the picker to mirror it. Pending counts come
  // from a separate aggregate query because PostgREST doesn't expose
  // GROUP BY across joins cleanly.
  const { data: divs, error: divErr } = await supabase
    .from("divisions")
    .select("id, name")
    .eq("synced", true)
    .order("name", { ascending: true });
  if (divErr) throw divErr;
  const counts = await loadPendingCountsByDivision(supabase);
  return ((divs ?? []) as { id: string; name: string }[]).map((d) => ({
    id: d.id,
    name: d.name,
    pendingCount: counts.get(d.id) ?? 0,
  }));
}

async function loadLocations(
  supabase: ReturnType<typeof createClient>,
  divisionId: string,
): Promise<PickerNode[]> {
  const { data: locs, error: locErr } = await supabase
    .from("locations")
    .select("id, name")
    .eq("division_id", divisionId)
    .order("name", { ascending: true });
  if (locErr) throw locErr;
  const counts = await loadPendingCountsByLocation(supabase, divisionId);
  return ((locs ?? []) as { id: string; name: string }[]).map((l) => ({
    id: l.id,
    name: l.name,
    pendingCount: counts.get(l.id) ?? 0,
  }));
}

async function loadCampWeeks(
  supabase: ReturnType<typeof createClient>,
  locationId: string,
): Promise<PickerNode[]> {
  const { data: weeks, error: wkErr } = await supabase
    .from("camp_weeks")
    .select("id, name, starts_on")
    .eq("location_id", locationId)
    .order("starts_on", { ascending: false });
  if (wkErr) throw wkErr;
  const counts = await loadPendingCountsByCampWeek(supabase, locationId);
  return ((weeks ?? []) as { id: string; name: string; starts_on: string }[]).map((w) => ({
    id: w.id,
    name: w.name,
    pendingCount: counts.get(w.id) ?? 0,
  }));
}

// Count helpers — each runs one focused query against `photos` joined
// upward to whichever level we're aggregating at. Pulls only the join
// keys (no row data) so the response is small even with thousands of
// photos. Pagination defends against PostgREST's 1000-row default.

async function loadPendingCountsByDivision(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, camp_weeks!inner ( locations!inner ( division_id ) )")
      .eq("current_status", "pending")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    type Raw = { id: string; camp_weeks: { locations: { division_id: string } | null } | null };
    const rows = (data ?? []) as unknown as Raw[];
    for (const r of rows) {
      const did = r.camp_weeks?.locations?.division_id;
      if (!did) continue;
      out.set(did, (out.get(did) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadPendingCountsByLocation(
  supabase: ReturnType<typeof createClient>,
  divisionId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, camp_weeks!inner ( location_id, locations!inner ( division_id ) )")
      .eq("current_status", "pending")
      .eq("camp_weeks.locations.division_id", divisionId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    type Raw = { id: string; camp_weeks: { location_id: string } | null };
    const rows = (data ?? []) as unknown as Raw[];
    for (const r of rows) {
      const lid = r.camp_weeks?.location_id;
      if (!lid) continue;
      out.set(lid, (out.get(lid) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadPendingCountsByCampWeek(
  supabase: ReturnType<typeof createClient>,
  locationId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, camp_week_id, camp_weeks!inner ( location_id )")
      .eq("current_status", "pending")
      .eq("camp_weeks.location_id", locationId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    type Raw = { id: string; camp_week_id: string };
    const rows = (data ?? []) as unknown as Raw[];
    for (const r of rows) {
      out.set(r.camp_week_id, (out.get(r.camp_week_id) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue list card
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_PAGE_SIZE = 25;

function QueueListCard({
  queueOrder,
  refreshTick,
}: {
  queueOrder: QueueOrder;
  refreshTick: number;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [filter, setFilter] = React.useState<QueueFilter>("all");
  const [page, setPage] = React.useState(0);
  const [rows, setRows] = React.useState<QueueRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchQueueList(supabase, { page, pageSize: QUEUE_PAGE_SIZE, filter, queueOrder })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.message ?? "Failed to load queue";
        setLoadError(msg);
        setRows([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [supabase, filter, queueOrder, page, refreshTick]);

  // Reset to page 0 when filter changes — otherwise an admin can land on
  // page 5 of "priority" and see a misleading "Showing none" if the
  // filtered set is shorter.
  React.useEffect(() => { setPage(0); }, [filter]);

  const totalPages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const startIdx = total === 0 ? 0 : page * QUEUE_PAGE_SIZE + 1;
  const endIdx   = Math.min(total, (page + 1) * QUEUE_PAGE_SIZE);

  return (
    <div className="card">
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "baseline", marginBottom: 4, gap: 12, flexWrap: "wrap",
      }}>
        <h3 className="card-title">Queue</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "priority", "recent"] as QueueFilter[]).map((f) => (
            <button
              key={f}
              className="btn btn-ghost"
              style={{
                padding: "4px 12px", fontSize: 12,
                background: filter === f ? "var(--ink)" : "transparent",
                color: filter === f ? "var(--paper)" : "var(--ink-2)",
              }}
              onClick={() => setFilter(f)}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Pending photos in the reviewer queue, ordered the same way reviewers see them
        (priority desc, uploaded {queueOrder === "newest_first" ? "newest first" : "oldest first"}).
      </div>

      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={th}>Photo</th>
              <th style={th}>Camp</th>
              <th style={th}>Uploaded</th>
              <th style={th}>Priority</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>
                {filter === "priority" ? "No prioritized photos." : filter === "recent" ? "No photos uploaded in the last 14 days." : "Queue is empty."}
              </td></tr>
            ) : rows.map((r) => (
              <QueueRowView key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 14, fontSize: 12, color: "var(--ink-3)",
      }}>
        <div>Showing {startIdx}–{endIdx} of {total}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
                  disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ‹ Prev
          </button>
          <span style={{ padding: "4px 8px" }}>Page {page + 1} / {totalPages}</span>
          <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
                  disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}

function QueueRowView({ row }: { row: QueueRow }) {
  return (
    <tr style={{ borderTop: "1px solid var(--rule)" }}>
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {row.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.thumbnailUrl}
              alt=""
              loading="lazy"
              style={{
                width: 56, height: 40, objectFit: "cover",
                borderRadius: 4, background: "var(--paper-2)",
              }}
            />
          ) : (
            <div style={{
              width: 56, height: 40, background: "var(--paper-2)",
              borderRadius: 4, fontSize: 10, color: "var(--ink-3)",
              display: "grid", placeItems: "center",
            }}>—</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)" }}>
              {row.smugmugImageId}
            </div>
            {row.caption && (
              <div style={{
                fontSize: 12, color: "var(--ink-2)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220,
              }}>{row.caption}</div>
            )}
          </div>
        </div>
      </td>
      <td style={td}>
        <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
          {[row.divisionName, row.locationName].filter(Boolean).join(" · ") || "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{row.campWeekName ?? "—"}</div>
      </td>
      <td style={td}>{formatDateTimeShort(row.capturedAt)}</td>
      <td style={td}>
        {row.priority > 0 ? (
          <span className="pill pill-sun">priority {row.priority}</span>
        ) : (
          <span style={{ color: "var(--ink-3)", fontSize: 12 }}>—</span>
        )}
      </td>
      <td style={td}>
        <StatusPill status={row.currentStatus} />
      </td>
    </tr>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--rule)", fontWeight: 500 };
const td: React.CSSProperties = { padding: "10px", verticalAlign: "top" };

function StatusPill({ status }: { status: QueueRow["currentStatus"] }) {
  if (status === "pending")  return <span className="pill">pending</span>;
  if (status === "approved") return <span className="pill pill-moss">approved</span>;
  if (status === "flagged")  return <span className="pill pill-rose">flagged</span>;
  return <span className="pill">deleted</span>;
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
  const label =
    kind === "scheduled"       ? "Scheduled"    :
    kind === "manual"          ? "Manual"       :
    kind === "mode_switch"     ? "Mode switch"  :
    kind === "priority_add"    ? "Priority"     :
    kind === "quarantine_move" ? "Quarantine"   :
    "Other";
  const cls =
    kind === "scheduled"       ? "pill pill-lake" :
    kind === "manual"          ? "pill pill-moss" :
    kind === "mode_switch"     ? "pill pill-rose" :
    kind === "priority_add"    ? "pill pill-sun"  :
    kind === "quarantine_move" ? "pill pill-rose" :
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
function queueOrderLabel(q: QueueOrder): string {
  return q === "newest_first" ? "Newest first" : "Oldest first";
}
function filterLabel(f: QueueFilter): string {
  return f === "all" ? "All" : f === "priority" ? "Priority only" : "Recent (14d)";
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
