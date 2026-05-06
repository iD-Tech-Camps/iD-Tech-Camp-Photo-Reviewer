"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { EXAMPLES, PhotoPlaceholder } from "@/components/data";
import { useCurrentUser, ROLE_LABEL } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import { fetchMyStats, type ReviewerStats } from "@/lib/profile";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Builds the "<First> <Last.>" header. The last name is wrapped in an <em>
// because the page-title renderer accepts dangerouslySetInnerHTML — same
// pattern used everywhere else in the app. Falls back to the email local
// part if the Google profile didn't supply a full name.
function buildTitle(fullName: string | null, email: string | null): string {
  const name = (fullName ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      const first = escapeHtml(parts.slice(0, -1).join(" "));
      const last = escapeHtml(parts[parts.length - 1]);
      return `${first} <em>${last}.</em>`;
    }
    return `<em>${escapeHtml(name)}.</em>`;
  }
  if (email) {
    return `<em>${escapeHtml(email.split("@")[0])}.</em>`;
  }
  return "<em>Reviewer.</em>";
}

function formatJoinedDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function ProfileScreen() {
  const { id: profileId, email, fullName, role, loading: userLoading } = useCurrentUser();
  const [stats, setStats] = React.useState<ReviewerStats | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const supabase = createClient();
    fetchMyStats(supabase, profileId)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((err) => {
        console.error("[profile] fetchMyStats failed:", err);
        if (!cancelled) setLoadError(err?.message ?? "Failed to load stats");
      });
    return () => { cancelled = true; };
  }, [profileId]);

  const teamLabel = stats?.team?.trim() || "—";
  const roleLabel = ROLE_LABEL[stats?.role ?? role];
  const joined = formatJoinedDate(stats?.createdAt ?? null);
  const sub = [
    teamLabel,
    roleLabel,
    joined ? `Joined ${joined}` : null,
  ].filter(Boolean).join(" · ");

  const title = buildTitle(stats?.fullName ?? fullName, stats?.email ?? email);
  const eyebrow = userLoading && !stats ? "Loading profile…" : "Your profile";

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} sub={sub} />

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <CareerStatsCard stats={stats} loadError={loadError} />
          <DecisionBreakdownCard stats={stats} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ActivityCard stats={stats} />
        </div>
      </div>
    </>
  );
}

function CareerStatsCard({
  stats,
  loadError,
}: {
  stats: ReviewerStats | null;
  loadError: string | null;
}) {
  const sinceLabel = stats?.createdAt
    ? `Since ${new Date(stats.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}`
    : "Career";

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Career stats</h3>
        <span className="card-eyebrow">{sinceLabel}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
        <div className="stat">
          <span className="stat-label">Total points</span>
          <span className="stat-value">
            {stats ? stats.totalPoints.toLocaleString() : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Photos reviewed</span>
          <span className="stat-value">
            {stats ? stats.totalReviews.toLocaleString() : "—"}
          </span>
        </div>
      </div>
      {loadError && (
        <div style={{
          marginTop: 12, fontSize: 12, color: "var(--rose)",
        }}>
          {loadError}
        </div>
      )}
    </div>
  );
}

function DecisionBreakdownCard({ stats }: { stats: ReviewerStats | null }) {
  // Approves + flags + deletes = totalReviews. Showing the breakdown is the
  // closest analog to the old "By camp" panel, but driven by data we can
  // actually compute from the existing schema (no photos/camp_weeks join
  // needed). Add a real "By camp" view in step 8 once SmugMug data lands.
  const rows: [string, number, string][] = [
    ["Approves", stats?.approves ?? 0, "moss"],
    ["Flags",    stats?.flags    ?? 0, "sun"],
    ["Deletes",  stats?.deletes  ?? 0, "rose"],
  ];
  const total = stats?.totalReviews ?? 0;

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Decision breakdown</h3>
        <span className="card-eyebrow">
          {total === 0 ? "No reviews yet" : `${total.toLocaleString()} total`}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map(([label, count, color]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={label} style={{
              display: "grid", gridTemplateColumns: "120px 1fr auto",
              alignItems: "center", gap: 12,
              padding: "10px 0", borderTop: "1px solid var(--rule)",
              fontSize: 13,
            }}>
              <span style={{ color: "var(--ink-2)" }}>{label}</span>
              <div className="progress-track" style={{ height: 6 }}>
                <div className="progress-fill" style={{
                  width: `${pct}%`,
                  background: `var(--${color})`,
                }} />
              </div>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 12,
                color: "var(--ink-2)", minWidth: 36, textAlign: "right",
              }}>
                {count.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityCard({ stats }: { stats: ReviewerStats | null }) {
  const today = stats?.reviewedToday ?? 0;
  const lastReviewed = stats?.lastReviewedAt
    ? formatRelativeFromIso(stats.lastReviewedAt)
    : null;

  return (
    <div className="card">
      <div className="card-eyebrow">Activity</div>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 500,
        letterSpacing: "-0.02em", marginTop: 4,
      }}>
        {today.toLocaleString()}
        <span style={{
          fontSize: 14, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
          fontWeight: 400, marginLeft: 6,
        }}>
          today
        </span>
      </div>
      <div style={{
        fontSize: 13, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5,
      }}>
        {lastReviewed
          ? <>Last review <strong style={{ color: "var(--ink-2)", fontWeight: 500 }}>{lastReviewed}</strong>.</>
          : <>No reviews yet — head to the <strong style={{ color: "var(--ink-2)", fontWeight: 500 }}>Review</strong> queue to start.</>}
      </div>
    </div>
  );
}

function formatRelativeFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)  return `${min}m ago`;
  const hr  = Math.round(min / 60);
  if (hr  < 24)  return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7)   return `${day}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function GuideScreen() {
  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="The <em>photo guide.</em>"
        sub="Admin-curated examples. Updated June 6 by Harper Rowe."
      />

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card" style={{ gridColumn: "span 2" }}>
          <h3 className="card-title" style={{ marginBottom: 12 }}>The 30-second rubric</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {[
              ["01", "Can you see a face?", "At least one subject's face should be visible and in focus."],
              ["02", "Does it feel safe?",   "Nothing you'd be uncomfortable sending to a parent."],
              ["03", "Is the camp readable?","Backdrop should suggest what the kids are doing."],
            ].map(([n, q, a]) => (
              <div key={n} className="accent-bar">
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  color: "var(--ink-3)", letterSpacing: "0.1em",
                }}>STEP {n}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 500, margin: "4px 0 6px", letterSpacing: "-0.01em" }}>
                  {q}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4 }}>{a}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <span className="card-eyebrow" style={{ color: "var(--moss)" }}>Approve these</span>
              <h3 className="card-title">Good photos</h3>
            </div>
            <span className="pill pill-moss">
              <Icon name="check" size={10} /> {EXAMPLES.good.length} examples
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {EXAMPLES.good.map(ex => (
              <div key={ex.id}>
                <div style={{
                  aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                  position: "relative", border: "2px solid var(--moss)", marginBottom: 8,
                }}>
                  <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500 }}>
                  {ex.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  {ex.note}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <span className="card-eyebrow" style={{ color: "var(--sun)" }}>Flag these</span>
              <h3 className="card-title">Problem photos</h3>
            </div>
            <span className="pill pill-sun">
              <Icon name="flag" size={10} /> {EXAMPLES.bad.length} examples
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {EXAMPLES.bad.map((ex, i) => (
              <div key={ex.id}>
                <div style={{
                  aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                  position: "relative", border: "2px solid var(--sun)", marginBottom: 8,
                  filter: i === 0 ? "blur(2px)" : "none",
                }}>
                  <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500 }}>
                  {ex.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  {ex.note}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
