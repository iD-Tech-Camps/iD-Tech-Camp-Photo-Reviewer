"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import { usePoints } from "@/lib/points-context";
import {
  fetchSelfWeeklyBreakdown,
  fetchSelfWindowedPoints,
  type WeeklyBreakdownRow,
  type WindowedTotal,
} from "@/lib/points";

// Reviewer-facing stats hub. See spec/GAMIFICATION_SPEC.md §5d.
//
// The "today / this week / all-time" toggle buckets points_ledger.occurred_at
// by UTC day — same convention as the Tuesday UTC sample-burst cron. Per-user
// timezone is intentionally deferred (no UX cost yet; would require either
// a profile column or a per-request offset).

type WindowKey = "today" | "week" | "all";

const WINDOW_LABELS: Record<WindowKey, string> = {
  today: "Today",
  week:  "This week",
  all:   "All-time",
};

// Start of the UTC day that contains `ms`.
function startOfUtcDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sinceIsoFor(window: WindowKey): string | null {
  if (window === "all") return null;
  const now = Date.now();
  if (window === "today") return startOfUtcDay(now).toISOString();
  // "This week" = rolling 7 UTC days ending today. Simpler than DOW math and
  // a more reviewer-friendly read of "this week" than a calendar week.
  return startOfUtcDay(now - 6 * 24 * 60 * 60 * 1000).toISOString();
}

function formatWeekRange(startsOn: string, endsOn: string): string {
  const start = new Date(startsOn);
  const end = new Date(endsOn);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startsOn} — ${endsOn}`;
  }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startStr = start.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const endStr = end.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startStr} — ${endStr}`;
}

export function MyStatsApp() {
  const supabase = React.useMemo(() => createClient(), []);
  const { id: userId, fullName, firstName } = useCurrentUser();
  const points = usePoints();
  const [window, setWindow] = React.useState<WindowKey>("all");
  const [windowed, setWindowed] = React.useState<WindowedTotal | null>(null);
  const [windowedLoading, setWindowedLoading] = React.useState(false);
  const [windowedError, setWindowedError] = React.useState<string | null>(null);

  const [weekly, setWeekly] = React.useState<WeeklyBreakdownRow[] | null>(null);
  const [weeklyError, setWeeklyError] = React.useState<string | null>(null);

  // Refetch the windowed headline when the window or user changes, and on
  // entry to the screen (mount). The `points.total` is part of the
  // dependency so an optimistic bump from Triage re-runs this fetch
  // reconciliation pass too — keeps the headline honest after a submit.
  React.useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setWindowedLoading(true);
    setWindowedError(null);
    fetchSelfWindowedPoints(supabase, userId, sinceIsoFor(window))
      .then((row) => {
        if (cancelled) return;
        setWindowed(row);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setWindowedError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => { if (!cancelled) setWindowedLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, userId, window, points.total]);

  // Per-week breakdown — load once per user; reconcile on bump (via
  // points.total dependency) so a newly-reviewed photo lifts the right
  // week's row without manual refresh.
  React.useEffect(() => {
    if (!userId) {
      setWeekly([]);
      return;
    }
    let cancelled = false;
    setWeeklyError(null);
    fetchSelfWeeklyBreakdown(supabase, userId)
      .then((rows) => { if (!cancelled) setWeekly(rows); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setWeeklyError(err instanceof Error ? err.message : "Failed to load");
        setWeekly([]);
      });
    return () => { cancelled = true; };
  }, [supabase, userId, points.total]);

  const firstShown = firstName || fullName?.split(/\s+/)[0] || "you";
  const headlinePoints = windowed?.totalPoints ?? 0;
  const headlineCount = windowed?.eventCount ?? 0;
  const allTimePoints = points.total ?? 0;
  const allTimeEvents = points.eventCount ?? 0;
  const showEmpty =
    !windowedLoading &&
    !points.loading &&
    allTimePoints === 0 &&
    allTimeEvents === 0;

  return (
    <>
      <PageHeader
        eyebrow="My stats"
        title={`Nice work${firstShown ? `, ${firstShown}` : ""}.`}
        sub="Points from Camp Quality Review and Camp Photo Review."
      />

      <div
        className="page-body"
        style={{ display: "flex", flexDirection: "column", gap: 20 }}
      >
        <div className="card">
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            {(Object.keys(WINDOW_LABELS) as WindowKey[]).map((key) => {
              const on = window === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWindow(key)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: on
                      ? "1.5px solid var(--ink)"
                      : "1px solid var(--rule)",
                    background: on ? "var(--paper-3)" : "var(--paper)",
                    color: "var(--ink)",
                    fontSize: 12,
                    fontWeight: on ? 500 : 400,
                    cursor: "pointer",
                  }}
                >
                  {WINDOW_LABELS[key]}
                </button>
              );
            })}
          </div>

          {windowedError && (
            <div
              style={{
                padding: 10,
                marginBottom: 12,
                border: "1px solid var(--rose)",
                borderRadius: 6,
                background: "var(--rose-soft)",
                color: "var(--rose)",
                fontSize: 12,
              }}
            >
              Couldn&apos;t load headline: {windowedError}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              opacity: windowedLoading && windowed === null ? 0.5 : 1,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 56,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              {headlinePoints.toLocaleString()}
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-2)" }}>
              point{headlinePoints === 1 ? "" : "s"} ·{" "}
              <span style={{ color: "var(--ink-3)" }}>
                {headlineCount.toLocaleString()} photo
                {headlineCount === 1 ? "" : "s"} reviewed
              </span>
            </div>
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {window === "all"
              ? "All time"
              : window === "today"
              ? "Since 00:00 UTC today"
              : "Last 7 UTC days"}
            {window !== "all" && allTimePoints > 0 && (
              <span style={{ marginLeft: 8 }}>
                · {allTimePoints.toLocaleString()} all-time
              </span>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <h3 className="card-title" style={{ margin: 0 }}>
              By camp week
            </h3>
            <div
              style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}
            >
              Weeks you&apos;ve touched, most recent first.
            </div>
          </div>

          {weeklyError && (
            <div
              style={{
                margin: 14,
                padding: 10,
                border: "1px solid var(--rose)",
                borderRadius: 6,
                background: "var(--rose-soft)",
                color: "var(--rose)",
                fontSize: 12,
              }}
            >
              Couldn&apos;t load breakdown: {weeklyError}
            </div>
          )}

          {weekly === null ? (
            <div
              style={{
                padding: 18,
                color: "var(--ink-3)",
                fontSize: 13,
              }}
            >
              Loading…
            </div>
          ) : showEmpty ? (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                color: "var(--ink-3)",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <Icon name="review" size={28} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-2)" }}>
                No review activity yet
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Claim a batch from Camp Quality Review or Camp Photo Review to start earning points.
              </div>
            </div>
          ) : weekly.length === 0 ? (
            <div
              style={{
                padding: 18,
                color: "var(--ink-3)",
                fontSize: 13,
              }}
            >
              No matching camp weeks.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Location · week</th>
                  <th style={{ width: 180 }}>Dates</th>
                  <th style={{ width: 90, textAlign: "right" }}>Photos</th>
                  <th style={{ width: 100, textAlign: "right" }}>Points</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w) => (
                  <tr key={w.campWeekId}>
                    <td>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {w.locationName}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-3)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {w.weekName}
                      </div>
                    </td>
                    <td
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--ink-2)",
                      }}
                    >
                      {formatWeekRange(w.startsOn, w.endsOn)}
                    </td>
                    <td
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        textAlign: "right",
                        color: "var(--ink-2)",
                      }}
                    >
                      {w.eventCount.toLocaleString()}
                    </td>
                    <td
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        textAlign: "right",
                        color: "var(--ink)",
                      }}
                    >
                      {w.totalPoints.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
