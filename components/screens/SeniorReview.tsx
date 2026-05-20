"use client";

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { fetchTags, type Tag } from "@/lib/tags";
import { fetchSeniorRollupWeeks, type SeniorRollupWeek } from "@/lib/triage-senior";
import { SeniorDashboard } from "@/components/screens/Triage";

type View =
  | { kind: "hub" }
  | { kind: "week"; campWeekId: string };

const STATE_LABELS: Record<string, string> = {
  photos_in: "Not started",
  triage_in_progress: "In review",
  triage_done: "Ready for sign-off",
  senior_review: "In sign-off",
};

const STATE_TONE: Record<string, string> = {
  photos_in: "var(--ink-3)",
  triage_in_progress: "var(--sun)",
  triage_done: "var(--moss)",
  senior_review: "var(--ink)",
};

export function SeniorReviewApp({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [view, setView] = React.useState<View>({ kind: "hub" });
  const [weeks, setWeeks] = React.useState<SeniorRollupWeek[] | null>(null);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [weekSeniorTags, setWeekSeniorTags] = React.useState<Tag[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const [w, t, wt] = await Promise.all([
      fetchSeniorRollupWeeks(supabase),
      fetchTags(supabase, { purpose: "quality_flag" }),
      fetchTags(supabase, { purpose: "week_senior" }),
    ]);
    setWeeks(w);
    setTags(t);
    setWeekSeniorTags(wt);
  }, [supabase]);

  React.useEffect(() => {
    let cancelled = false;
    reload().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load review summary");
    });
    return () => { cancelled = true; };
  }, [reload]);

  if (view.kind === "week") {
    return (
      <SeniorDashboard
        toast={toast}
        supabase={supabase}
        campWeekId={view.campWeekId}
        tags={tags}
        weekSeniorTags={weekSeniorTags}
        onBack={() => { setView({ kind: "hub" }); void reload(); }}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Lead review"
        title="Active weeks <em>across the pipeline</em>"
        sub={weeks === null ? "Loading…" : `${weeks.length} week${weeks.length === 1 ? "" : "s"} in active review`}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{error}</div>}

        {weeks !== null && weeks.length === 0 && (
          <div className="card" style={{ color: "var(--ink-3)" }}>
            No camp weeks are in the active pipeline right now.
          </div>
        )}

        {(weeks ?? []).map((w) => (
          <WeekRow key={w.id} week={w} onOpen={() => setView({ kind: "week", campWeekId: w.id })} />
        ))}
      </div>
    </>
  );
}

function WeekRow({ week, onOpen }: { week: SeniorRollupWeek; onOpen: () => void }) {
  const triagedCount = week.cleanCount + week.flaggedCount + week.deletedCount;
  const denom = Math.max(0, week.totalPhotos - week.deletedCount);
  const pct = denom === 0 ? 0 : Math.round(((week.cleanCount + week.flaggedCount) / denom) * 100);

  const stateLabel = STATE_LABELS[week.triageState] ?? week.triageState;
  const stateTone = STATE_TONE[week.triageState] ?? "var(--ink-3)";
  const canOpen = week.triageState === "triage_done" || week.triageState === "senior_review";

  return (
    <div
      className="card"
      style={{
        display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {week.locationName} — {week.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {week.triageRole === "first_week" && "First week · "}
            {week.triageRole === "second_week_recheck" && "Follow-up review · "}
            Starts {week.startsOn}
          </div>
        </div>
        <span
          style={{
            display: "inline-flex", alignItems: "center",
            padding: "4px 10px", borderRadius: 999,
            fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
            textTransform: "uppercase",
            background: stateTone, color: "white",
            alignSelf: "flex-start",
          }}
        >
          {stateLabel}
        </span>
      </div>

      <div>
        <div
          aria-hidden
          style={{
            position: "relative",
            height: 8,
            borderRadius: 999,
            background: "var(--paper-3)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute", inset: 0,
              width: `${pct}%`,
              background: "var(--moss)",
              transition: "width 0.2s ease",
            }}
          />
        </div>
        <div
          style={{
            display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            marginTop: 6, fontSize: 12, color: "var(--ink-3)",
          }}
        >
          <span>
            {triagedCount} of {week.totalPhotos} reviewed ({pct}%)
          </span>
          <span style={{ display: "flex", gap: 12 }}>
            {week.pendingCount > 0 && <span>{week.pendingCount} pending</span>}
            {week.inProgressCount > 0 && <span>{week.inProgressCount} in progress</span>}
            <span style={{ color: week.flaggedCount > 0 ? "var(--rose)" : undefined }}>
              {week.flaggedCount} {week.flaggedCount === 1 ? "issue" : "issues"}
            </span>
            {week.quarantinedCount > 0 && <span>{week.quarantinedCount} hidden from parents</span>}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className={"btn " + (canOpen ? "btn-primary" : "btn-ghost")}
          onClick={onOpen}
        >
          {canOpen ? "Open review" : "View week"}
        </button>
      </div>
    </div>
  );
}
