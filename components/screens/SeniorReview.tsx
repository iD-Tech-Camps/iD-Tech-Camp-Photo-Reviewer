"use client";

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { fetchTags, type Tag } from "@/lib/tags";
import { fetchSeniorRollupWeeks, type SeniorRollupWeek } from "@/lib/triage-senior";
import { partitionSeniorHubWeeks, type SeniorHubSection } from "@/lib/senior-hub-sections";
import { SeniorWeekDashboard } from "@/components/screens/SeniorWeekDashboard";

type View =
  | { kind: "hub" }
  | { kind: "week"; campWeekId: string };

const STATE_LABELS: Record<string, string> = {
  awaiting_photos: "Awaiting photos",
  photos_in: "Not started",
  triage_in_progress: "Reviewers working",
  triage_done: "Ready for sign-off",
  senior_review: "In sign-off",
  complete: "Approved",
};

const STATE_TONE: Record<string, string> = {
  awaiting_photos: "var(--ink-3)",
  photos_in: "var(--ink-3)",
  triage_in_progress: "var(--sun)",
  triage_done: "var(--moss)",
  senior_review: "var(--ink)",
  complete: "var(--moss)",
};

const SECTION_META: Record<SeniorHubSection, { title: string; empty: string }> = {
  needReview: {
    title: "Need review",
    empty: "No weeks need lead attention right now.",
  },
  inProgress: {
    title: "In progress",
    empty: "No weeks are with reviewers without open issues.",
  },
  upcoming: {
    title: "Upcoming",
    empty: "No upcoming weeks awaiting photos.",
  },
  finished: {
    title: "Finished",
    empty: "No approved weeks yet this season.",
  },
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

  const sections = React.useMemo(
    () => (weeks ? partitionSeniorHubWeeks(weeks) : null),
    [weeks],
  );

  if (view.kind === "week") {
    return (
      <SeniorWeekDashboard
        toast={toast}
        supabase={supabase}
        campWeekId={view.campWeekId}
        tags={tags}
        weekSeniorTags={weekSeniorTags}
        onBack={() => { setView({ kind: "hub" }); void reload(); }}
      />
    );
  }

  const totalWeeks = weeks?.length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Lead review"
        title="Camp weeks <em>pipeline</em>"
        sub={weeks === null ? "Loading…" : `${totalWeeks} week${totalWeeks === 1 ? "" : "s"} tracked`}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {error && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{error}</div>}

        {sections && (
          (["needReview", "inProgress", "upcoming", "finished"] as const).map((key) => (
            <section key={key} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="page-eyebrow" style={{ margin: 0 }}>
                {SECTION_META[key].title} ({sections[key].length})
              </h2>
              {sections[key].length === 0 ? (
                <div className="card" style={{ color: "var(--ink-3)" }}>{SECTION_META[key].empty}</div>
              ) : (
                sections[key].map((w) => (
                  <WeekRow
                    key={w.id}
                    week={w}
                    section={key}
                    onOpen={() => setView({ kind: "week", campWeekId: w.id })}
                  />
                ))
              )}
            </section>
          ))
        )}
      </div>
    </>
  );
}

function WeekRow({
  week,
  section,
  onOpen,
}: {
  week: SeniorRollupWeek;
  section: SeniorHubSection;
  onOpen: () => void;
}) {
  const triagedCount = week.cleanCount + week.flaggedCount + week.deletedCount;
  const denom = Math.max(0, week.totalPhotos - week.deletedCount);
  const pct = denom === 0 ? 0 : Math.round(((week.cleanCount + week.flaggedCount) / denom) * 100);

  const stateLabel = STATE_LABELS[week.triageState] ?? week.triageState;
  const stateTone = STATE_TONE[week.triageState] ?? "var(--ink-3)";
  const isFinished = section === "finished";
  const emphasizeIssues = section === "needReview" && week.flaggedCount > 0;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {week.locationName} — {week.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {week.triageRole === "first_week" && "First week · "}
            {week.triageRole === "second_week_recheck" && "Follow-up review · "}
            Starts {week.startsOn}
            {isFinished && week.signoffAt && (
              <> · Approved {new Date(week.signoffAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
            )}
            {isFinished && week.signoffByName && <> by {week.signoffByName}</>}
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

      {!isFinished && week.totalPhotos > 0 && (
        <div>
          <div
            aria-hidden
            style={{
              position: "relative", height: 8, borderRadius: 999,
              background: "var(--paper-3)", overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute", inset: 0, width: `${pct}%`,
                background: "var(--moss)", transition: "width 0.2s ease",
              }}
            />
          </div>
          <div
            style={{
              display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
              marginTop: 6, fontSize: 12, color: "var(--ink-3)",
            }}
          >
            <span>{triagedCount} of {week.totalPhotos} reviewed ({pct}%)</span>
            <span style={{ display: "flex", gap: 12 }}>
              {week.pendingCount > 0 && <span>{week.pendingCount} pending</span>}
              {week.inProgressCount > 0 && <span>{week.inProgressCount} in progress</span>}
              <span style={{
                color: emphasizeIssues ? "var(--rose)" : week.flaggedCount > 0 ? "var(--rose)" : undefined,
                fontWeight: emphasizeIssues ? 600 : undefined,
              }}>
                {week.flaggedCount} {week.flaggedCount === 1 ? "issue" : "issues"}
              </span>
              {week.quarantinedCount > 0 && <span>{week.quarantinedCount} hidden</span>}
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className={"btn " + (section === "needReview" && !isFinished ? "btn-primary" : "btn-ghost")}
          onClick={onOpen}
        >
          {isFinished ? "View report" : section === "needReview" ? "Open review" : "View week"}
        </button>
      </div>
    </div>
  );
}
