"use client";

import React from "react";
import { Breadcrumb, PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { fetchTags, type Tag } from "@/lib/tags";
import { SeniorWeekDashboard } from "@/components/screens/SeniorWeekDashboard";
import { FeedbackRow } from "@/components/FeedbackThread";
import {
  approveLocation,
  classifyLocation,
  fetchLocationDetail,
  fetchLocationSummaries,
  revokeLocation,
  type FeedbackEvent,
  type LocationCampWeek,
  type LocationDetail,
  type LocationLifecycle,
  type LocationSummary,
} from "@/lib/location-approval";
import {
  parseSeniorReviewViewFromUrl,
  usePersistedView,
  writeSeniorReviewViewToUrl,
  type SeniorReviewView,
} from "@/lib/app-route";
import {
  groupFeedbackByWeek,
  partitionLocationWeeks,
} from "@/lib/location-detail-sections";
import {
  dismissUploadAlert,
  fetchUploadAlerts,
  type UploadAlert,
} from "@/lib/upload-alerts";

// Per-card status label keyed on lifecycle stage so "Needs your review" stops
// appearing on dormant locations. Sections supply the broader grouping; this
// label is the per-row hint about what specifically is going on.
function statusForLifecycle(
  stage: LocationLifecycle,
  loc: LocationSummary,
): { label: string; tone: string } {
  switch (stage) {
    case "needs_attention":
      if (loc.pendingCount > 0 || loc.inProgressCount > 0) {
        return { label: "Photos waiting for review", tone: "var(--ink-3)" };
      }
      return { label: "Ready for your approval", tone: "var(--sun)" };
    case "awaiting_re_review":
      return { label: "Awaiting re-review", tone: "var(--ink-3)" };
    case "photos_arriving":
      return { label: "Awaiting photos", tone: "var(--ink-3)" };
    case "upcoming":
      return {
        label: loc.firstWeekStart
          ? `Starts ${new Date(loc.firstWeekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          : "Upcoming",
        tone: "var(--ink-3)",
      };
    case "approved":
      return { label: "Approved", tone: "var(--moss)" };
    case "out_of_season":
      return { label: "Not in season", tone: "var(--ink-3)" };
  }
}

type SectionKey = LocationLifecycle;

const SECTION_META: Record<
  SectionKey,
  { title: string; defaultCollapsed: boolean; hideWhenEmpty: boolean; empty?: string }
> = {
  needs_attention: {
    title: "Needs your attention",
    defaultCollapsed: false,
    hideWhenEmpty: false,
    empty: "All caught up — nothing waiting on you.",
  },
  awaiting_re_review: {
    title: "Awaiting re-review",
    defaultCollapsed: false,
    hideWhenEmpty: true,
  },
  photos_arriving: {
    title: "Photos arriving",
    defaultCollapsed: false,
    hideWhenEmpty: true,
  },
  upcoming: {
    title: "Upcoming",
    defaultCollapsed: false,
    hideWhenEmpty: true,
  },
  approved: {
    title: "Approved",
    defaultCollapsed: true,
    hideWhenEmpty: true,
  },
  out_of_season: {
    title: "Not in current season",
    defaultCollapsed: true,
    hideWhenEmpty: true,
  },
};

const SECTION_ORDER: SectionKey[] = [
  "needs_attention",
  "awaiting_re_review",
  "photos_arriving",
  "upcoming",
  "approved",
  "out_of_season",
];

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SeniorReviewApp({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const parseView = React.useCallback(() => parseSeniorReviewViewFromUrl(), []);
  const writeView = React.useCallback((v: SeniorReviewView) => writeSeniorReviewViewToUrl(v), []);
  const [view, setView] = usePersistedView(parseView, writeView, { kind: "hub" });
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [weekSeniorTags, setWeekSeniorTags] = React.useState<Tag[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchTags(supabase, { purpose: "quality_flag" }),
      fetchTags(supabase, { purpose: "week_senior" }),
    ])
      .then(([t, wt]) => {
        if (cancelled) return;
        setTags(t);
        setWeekSeniorTags(wt);
      })
      .catch(() => {
        // Tag fetch is best-effort — drill-down still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (view.kind === "week") {
    return (
      <SeniorWeekDashboard
        toast={toast}
        supabase={supabase}
        campWeekId={view.campWeekId}
        tags={tags}
        weekSeniorTags={weekSeniorTags}
        rootCrumb={{ label: "Lead review", onClick: () => setView({ kind: "hub" }) }}
        onNavigateLocation={
          view.locationId
            ? () => setView({ kind: "location", locationId: view.locationId! })
            : undefined
        }
      />
    );
  }

  if (view.kind === "location") {
    return (
      <LocationDetailView
        toast={toast}
        locationId={view.locationId}
        weekSeniorTags={weekSeniorTags}
        onBack={() => setView({ kind: "hub" })}
        onOpenWeek={(campWeekId) =>
          setView({ kind: "week", campWeekId, locationId: view.locationId })
        }
      />
    );
  }

  return (
    <LocationListView
      toast={toast}
      onOpenLocation={(locationId) => setView({ kind: "location", locationId })}
    />
  );
}

// ─── Location list ────────────────────────────────────────────────────────────

function LocationListView({
  toast,
  onOpenLocation,
}: {
  toast: ToastApi;
  onOpenLocation: (id: string) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [locations, setLocations] = React.useState<LocationSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Partial<Record<SectionKey, boolean>>>(() => {
    const init: Partial<Record<SectionKey, boolean>> = {};
    for (const k of SECTION_ORDER) init[k] = SECTION_META[k].defaultCollapsed;
    return init;
  });

  React.useEffect(() => {
    let cancelled = false;
    fetchLocationSummaries(supabase)
      .then((rows) => {
        if (!cancelled) setLocations(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load locations");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const today = new Date().toISOString().slice(0, 10);
  const sections = React.useMemo(() => {
    const buckets: Record<SectionKey, LocationSummary[]> = {
      needs_attention: [],
      awaiting_re_review: [],
      photos_arriving: [],
      upcoming: [],
      approved: [],
      out_of_season: [],
    };
    for (const loc of locations ?? []) {
      const stage = classifyLocation(loc, today);
      buckets[stage].push(loc);
    }
    // Sort each bucket. Needs-attention first by pending desc (most urgent
    // at the top), upcoming by start date asc, approved by most-recently
    // approved first, others alphabetically.
    buckets.needs_attention.sort((a, b) => (b.pendingCount + b.inProgressCount) - (a.pendingCount + a.inProgressCount) || a.name.localeCompare(b.name));
    buckets.awaiting_re_review.sort((a, b) => (b.revokedAt ?? "").localeCompare(a.revokedAt ?? ""));
    buckets.photos_arriving.sort((a, b) => (a.firstWeekStart ?? "").localeCompare(b.firstWeekStart ?? ""));
    buckets.upcoming.sort((a, b) => (a.firstWeekStart ?? "").localeCompare(b.firstWeekStart ?? ""));
    buckets.approved.sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));
    buckets.out_of_season.sort((a, b) => a.name.localeCompare(b.name));
    return buckets;
  }, [locations, today]);

  const total = locations?.length ?? 0;
  const inFocus =
    sections.needs_attention.length +
    sections.awaiting_re_review.length +
    sections.photos_arriving.length +
    sections.upcoming.length;

  const toggle = (k: SectionKey) =>
    setCollapsed((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <>
      <PageHeader
        eyebrow="Lead review"
        title="Locations <em>this season</em>"
        sub={
          locations === null
            ? "Loading…"
            : `${inFocus} active · ${sections.approved.length} approved · ${total} total`
        }
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <AlertsSection toast={toast} />

        {error && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{error}</div>}

        {SECTION_ORDER.map((key) => {
          const meta = SECTION_META[key];
          const rows = sections[key];
          if (meta.hideWhenEmpty && rows.length === 0) return null;
          const isCollapsed = collapsed[key] ?? meta.defaultCollapsed;

          return (
            <section key={key} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                type="button"
                onClick={() => toggle(key)}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  color: "inherit",
                  font: "inherit",
                }}
                aria-expanded={!isCollapsed}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 10,
                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform 120ms",
                    color: "var(--ink-3)",
                    fontSize: 10,
                  }}
                >
                  ▾
                </span>
                <h2 className="page-eyebrow" style={{ margin: 0 }}>
                  {meta.title} ({rows.length})
                </h2>
              </button>
              {!isCollapsed && (
                <>
                  {rows.length === 0 ? (
                    <div className="card" style={{ color: "var(--ink-3)", fontSize: 13 }}>
                      {meta.empty ?? "Nothing here."}
                    </div>
                  ) : (
                    rows.map((loc) => (
                      <LocationRow
                        key={loc.id}
                        loc={loc}
                        stage={key}
                        onOpen={() => onOpenLocation(loc.id)}
                      />
                    ))
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function LocationRow({
  loc,
  stage,
  onOpen,
}: {
  loc: LocationSummary;
  stage: LocationLifecycle;
  onOpen: () => void;
}) {
  const { label, tone } = statusForLifecycle(stage, loc);
  const isApproved = stage === "approved";
  const isReopened = stage === "awaiting_re_review";
  const isAttention = stage === "needs_attention";

  // Attribution line: who/when for approved + reopened. Most common follow-up
  // question right after "what's the status of this location?"
  let attribution: string | null = null;
  if (isApproved && loc.approvedAt) {
    attribution = `by ${loc.approvedByName ?? "—"} · ${relativeDate(loc.approvedAt)}`;
  } else if (isReopened && loc.revokedAt) {
    attribution = `Approval pulled back ${relativeDate(loc.revokedAt)}${loc.revokedByName ? ` by ${loc.revokedByName}` : ""}`;
  }

  // Stats line: only show counts that exist for this stage, so a "Photos
  // arriving" card doesn't show "0 photos in eligible weeks" as noise.
  const stats: React.ReactNode[] = [];
  if (loc.totalPhotos > 0) {
    stats.push(
      <span key="total">{loc.totalPhotos} photos in eligible weeks</span>,
    );
  }
  if (loc.pendingCount > 0) {
    stats.push(<span key="pending">{loc.pendingCount} pending</span>);
  }
  if (loc.flaggedCount > 0) {
    stats.push(
      <span key="flagged" style={{ color: "var(--rose)" }}>{loc.flaggedCount} flagged</span>,
    );
  }
  if (loc.lastFeedbackAt) {
    stats.push(
      <span key="feedback">
        Last feedback {relativeDate(loc.lastFeedbackAt)}
        {loc.lastFeedbackAuthor && <> by {loc.lastFeedbackAuthor}</>}
      </span>,
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{loc.name}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {loc.divisionName}
            {loc.firstWeekStart && !isApproved && (
              <>
                {" · "}First week {new Date(loc.firstWeekStart).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: tone,
              color: "white",
            }}
          >
            {label}
          </span>
          {attribution && (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{attribution}</span>
          )}
        </div>
      </div>

      {stats.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          {stats}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className={"btn " + (isAttention ? "btn-primary" : "btn-ghost")}
          onClick={onOpen}
        >
          {isApproved ? "View location" : "Open location"}
        </button>
      </div>
    </div>
  );
}

// ─── Upload alerts ──────────────────────────────────────────────────────────

// Weekly "this location stopped uploading" alerts, surfaced at the top of the
// lead hub. Alerts are static records: they persist until a lead dismisses one
// (they are not auto-cleared when photos eventually arrive). Dismissed alerts
// move into a collapsible history disclosure.
function AlertsSection({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [active, setActive] = React.useState<UploadAlert[]>([]);
  const [dismissed, setDismissed] = React.useState<UploadAlert[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { active: a, dismissed: d } = await fetchUploadAlerts(supabase);
    setActive(a);
    setDismissed(d);
    setLoaded(true);
  }, [supabase]);

  React.useEffect(() => {
    let cancelled = false;
    load().catch(() => {
      // Alerts are a best-effort overlay — a fetch failure shouldn't block the
      // hub. Leave the section hidden and let the location list render.
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleDismiss = async (id: string) => {
    setBusyId(id);
    try {
      await dismissUploadAlert(id);
      await load();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Dismiss failed");
    } finally {
      setBusyId(null);
    }
  };

  // Nothing to show until we know there's at least one alert (active or in
  // history). Keeps the hub clean in the common case.
  if (!loaded || (active.length === 0 && dismissed.length === 0)) return null;

  const weekLine = (a: UploadAlert) =>
    `No photos for ${a.weekLabel} (week of ${new Date(a.weekStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })})`;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="page-eyebrow" style={{ margin: 0, color: "var(--rose)" }}>
        Upload alerts ({active.length})
      </h2>

      {active.length === 0 ? (
        <div className="card" style={{ color: "var(--ink-3)", fontSize: 13 }}>
          No open upload alerts.
        </div>
      ) : (
        active.map((a) => (
          <div
            key={a.id}
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
              borderLeft: "4px solid var(--rose)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {a.divisionName} · {a.locationName}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                {weekLine(a)} · flagged {relativeDate(a.detectedAt)}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => handleDismiss(a.id)}
              disabled={busyId === a.id}
            >
              {busyId === a.id ? "Dismissing…" : "Dismiss"}
            </button>
          </div>
        ))
      )}

      {dismissed.length > 0 && (
        <CollapsibleSection title="Dismissed" count={dismissed.length} defaultCollapsed>
          {dismissed.map((a) => (
            <div
              key={a.id}
              className="card"
              style={{ display: "flex", flexDirection: "column", gap: 4, opacity: 0.75 }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {a.divisionName} · {a.locationName}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {weekLine(a)}
                {a.dismissedAt && (
                  <>
                    {" · "}dismissed {relativeDate(a.dismissedAt)}
                    {a.dismissedByName ? ` by ${a.dismissedByName}` : ""}
                  </>
                )}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      )}
    </section>
  );
}

// ─── Location detail ──────────────────────────────────────────────────────────

function LocationDetailView({
  toast,
  locationId,
  weekSeniorTags,
  onBack,
  onOpenWeek,
}: {
  toast: ToastApi;
  locationId: string;
  weekSeniorTags: Tag[];
  onBack: () => void;
  onOpenWeek: (campWeekId: string) => void;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [detail, setDetail] = React.useState<LocationDetail | null>(null);
  const [weeks, setWeeks] = React.useState<LocationCampWeek[]>([]);
  const [feedback, setFeedback] = React.useState<FeedbackEvent[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    const { detail: d, weeks: w, feedback: f } = await fetchLocationDetail(supabase, locationId);
    setDetail(d);
    setWeeks(w);
    setFeedback(f);
  }, [supabase, locationId]);

  React.useEffect(() => {
    let cancelled = false;
    reload().catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "Failed to load location");
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const handleApprove = async () => {
    setBusy(true);
    try {
      await approveLocation(locationId);
      toast.show(
        "Location approved. Photos at this location are released from the Camp Quality Review queue.",
      );
      setApproveOpen(false);
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (reason: string) => {
    setBusy(true);
    try {
      await revokeLocation(locationId, reason || null);
      toast.show("Approval revoked. This location is back in the Camp Quality Review queue.");
      setRevokeOpen(false);
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  };

  const sections = React.useMemo(() => partitionLocationWeeks(weeks), [weeks]);
  const grouped = React.useMemo(() => groupFeedbackByWeek(feedback), [feedback]);

  if (!detail && !error) {
    return (
      <>
        <PageHeader eyebrow="Lead review" title="Loading…" />
        <div className="page-body" />
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <PageHeader eyebrow="Lead review" title="Error" />
        <div className="page-body">
          <div className="card" style={{ color: "var(--rose)" }}>{error}</div>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back to locations
          </button>
        </div>
      </>
    );
  }

  const detailStage = classifyLocation(detail, new Date().toISOString().slice(0, 10));
  const { label: statusLabel, tone } = statusForLifecycle(detailStage, detail);

  // Read-only summary of each week's review results and any feedback given.
  // Feedback is added on the week screen (via "Open week"), not here.
  const renderWeek = (w: LocationCampWeek) => (
    <WeekCard
      key={w.id}
      week={w}
      feedback={grouped.byWeek.get(w.id) ?? []}
      weekSeniorTags={weekSeniorTags}
      onOpen={() => onOpenWeek(w.id)}
    />
  );
  const noWeeks =
    sections.needsReview.length === 0 &&
    sections.recentlyReviewed.length === 0 &&
    sections.pastSeasons.length === 0;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Lead review", onClick: onBack },
              { label: detail.name },
            ]}
          />
        }
        title={detail.name}
        sub={`${detail.divisionName}`}
        onBack={onBack}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  background: tone,
                  color: "white",
                }}
              >
                {statusLabel}
              </span>
              {detail.approvedAt && detail.approvalStatus === "approved" && (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  by {detail.approvedByName ?? "—"} · {relativeDate(detail.approvedAt)}
                </span>
              )}
              {detail.revokedAt && detail.approvalStatus === "reopened" && (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  Revoked by {detail.revokedByName ?? "—"} · {relativeDate(detail.revokedAt)}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {detail.approvalStatus !== "approved" && (
                <button type="button" className="btn btn-primary" onClick={() => setApproveOpen(true)} disabled={busy}>
                  Approve location
                </button>
              )}
              {detail.approvalStatus === "approved" && (
                <button type="button" className="btn btn-ghost" onClick={() => setRevokeOpen(true)} disabled={busy}>
                  Revoke approval
                </button>
              )}
            </div>
          </div>
          {detail.evergreenNotes && (
            <div style={{ fontSize: 13, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>
              {detail.evergreenNotes}
            </div>
          )}
        </div>

        {noWeeks && (
          <div className="card" style={{ color: "var(--ink-3)" }}>
            No weeks have needed review at this location.
          </div>
        )}

        {sections.needsReview.length > 0 && (
          <CollapsibleSection title="Needs review" count={sections.needsReview.length}>
            {sections.needsReview.map((w) => renderWeek(w))}
          </CollapsibleSection>
        )}

        {sections.recentlyReviewed.length > 0 && (
          <CollapsibleSection title="Recently reviewed" count={sections.recentlyReviewed.length}>
            {sections.recentlyReviewed.map((w) => renderWeek(w))}
          </CollapsibleSection>
        )}

        {sections.pastSeasons.length > 0 && (
          <CollapsibleSection title="Past seasons" count={sections.pastSeasons.length} defaultCollapsed>
            {sections.pastSeasons.map((w) => renderWeek(w))}
          </CollapsibleSection>
        )}

        {grouped.unassigned.length > 0 && (
          <CollapsibleSection title="Unassigned notes" count={grouped.unassigned.length} defaultCollapsed>
            {grouped.unassigned.map((e) => (
              <FeedbackRow key={e.id} event={e} />
            ))}
          </CollapsibleSection>
        )}
      </div>

      {approveOpen && (
        <ApproveModal
          locationName={detail.name}
          pendingCount={detail.pendingCount}
          flaggedCount={detail.flaggedCount}
          onConfirm={handleApprove}
          onCancel={() => setApproveOpen(false)}
          busy={busy}
        />
      )}
      {revokeOpen && (
        <RevokeModal
          locationName={detail.name}
          onConfirm={handleRevoke}
          onCancel={() => setRevokeOpen(false)}
          busy={busy}
        />
      )}
    </>
  );
}

// Shared collapsible section: chevron disclosure mirroring the one inlined in
// LocationListView so the two Lead-review screens stay visually consistent.
function CollapsibleSection({
  title,
  count,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  count: number;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={{
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          color: "inherit",
          font: "inherit",
        }}
        aria-expanded={!collapsed}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 10,
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 120ms",
            color: "var(--ink-3)",
            fontSize: 10,
          }}
        >
          ▾
        </span>
        <h2 className="page-eyebrow" style={{ margin: 0 }}>
          {title} ({count})
        </h2>
      </button>
      {!collapsed && children}
    </section>
  );
}

// Read-only week summary: review results (counts, reviewed badge), the lead's
// highlights + assessment tags, and any feedback notes recorded. All editing
// happens on the week screen.
function WeekCard({
  week,
  feedback,
  weekSeniorTags,
  onOpen,
}: {
  week: LocationCampWeek;
  feedback: FeedbackEvent[];
  weekSeniorTags: Tag[];
  onOpen: () => void;
}) {
  const isEligible = week.triageRole !== "none";
  const reviewed = !!week.signoffAt;
  const highlights = [
    week.positiveGreatQuality && "Great Quality",
    week.positiveGreatVariety && "Great Variety",
    week.positiveShininessGreat && "Shininess Looks Great",
  ].filter((h): h is string => !!h);
  const tagMeta = new Map(weekSeniorTags.map((t) => [t.id, t]));
  const assessmentTags = week.assessmentTagIds
    .map((id) => tagMeta.get(id))
    .filter((t): t is Tag => !!t);
  const hasSummary =
    highlights.length > 0 || assessmentTags.length > 0 || feedback.length > 0;
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{week.name}</div>
            {reviewed && (
              <span
                title={
                  week.signoffByName
                    ? `Reviewed by ${week.signoffByName} on ${new Date(week.signoffAt!).toLocaleDateString()}`
                    : undefined
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  background: "var(--moss-soft, oklch(0.93 0.05 155))",
                  color: "var(--moss)",
                }}
              >
                ✓ Reviewed{week.signoffByName ? ` by ${week.signoffByName}` : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {new Date(week.startsOn).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {" – "}
            {new Date(week.endsOn).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {" · "}
            {week.totalPhotos} photos
            {week.pendingCount > 0 && <> · {week.pendingCount} pending</>}
            {week.flaggedCount > 0 && (
              <span style={{ color: "var(--rose)" }}> · {week.flaggedCount} flagged</span>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onOpen} disabled={!isEligible}>
          {isEligible ? "Open week" : "Not in season"}
        </button>
      </div>

      {hasSummary && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            borderTop: "1px solid var(--rule)",
            paddingTop: 12,
          }}
        >
          {highlights.length > 0 && (
            <SummaryGroup label="Highlights">
              {highlights.map((h) => (
                <span key={h} className="pill pill-moss">{h}</span>
              ))}
            </SummaryGroup>
          )}
          {assessmentTags.length > 0 && (
            <SummaryGroup label="Assessment">
              {assessmentTags.map((t) => (
                <span
                  key={t.id}
                  className={"pill " + (t.valence === "positive" ? "pill-moss" : "pill-rose")}
                >
                  {t.label}
                </span>
              ))}
            </SummaryGroup>
          )}
          {feedback.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {feedback.map((e) => (
                <FeedbackRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Small labeled row of pills used inside a week summary card.
function SummaryGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function ApproveModal({
  locationName,
  pendingCount,
  flaggedCount,
  onConfirm,
  onCancel,
  busy,
}: {
  locationName: string;
  pendingCount: number;
  flaggedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <ModalShell onCancel={onCancel}>
      <h3 style={{ margin: 0 }}>Approve {locationName} for the season?</h3>
      <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>
        Approving means you&apos;re satisfied with this location based on what
        you&apos;ve reviewed so far. This closes the Camp Quality Review queue
        for this location for the rest of the season. Here&apos;s what changes:
      </p>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
        {pendingCount > 0 ? (
          <li>
            <strong>{pendingCount} photo{pendingCount === 1 ? "" : "s"} waiting for review</strong> will
            be released — reviewers won&apos;t see them anymore.
          </li>
        ) : (
          <li>No photos are currently waiting for review at this location.</li>
        )}
        <li>
          Any reviewer mid-batch at this location is returned to the queue with a
          heads-up notification.
        </li>
        <li>
          New photos arriving here for the rest of the season skip Camp Quality Review automatically.
        </li>
        {flaggedCount > 0 && (
          <li>
            {flaggedCount} flagged photo{flaggedCount === 1 ? "" : "s"} stays in this
            location&apos;s week reports — flagged history isn&apos;t touched.
          </li>
        )}
        <li>You can undo this anytime — the location returns to the Camp Quality Review queue.</li>
      </ul>
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 6,
          background: "var(--paper-3)",
          fontSize: 12,
          color: "var(--ink-3)",
          lineHeight: 1.5,
        }}
      >
        Approving is different from <strong>Mark week as reviewed</strong> on individual
        weeks — that&apos;s just a per-week audit marker. Approving here is the
        season-closing decision.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? "Approving…" : "Approve location"}
        </button>
      </div>
    </ModalShell>
  );
}

function RevokeModal({
  locationName,
  onConfirm,
  onCancel,
  busy,
}: {
  locationName: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = React.useState("");
  return (
    <ModalShell onCancel={onCancel}>
      <h3 style={{ margin: 0 }}>Revoke approval for {locationName}?</h3>
      <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>
        Pending photos at this location will return to the Camp Quality Review queue.
        Claim batches that were already released stay released; reviewers
        won&apos;t time-travel back into their drained batches.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for revoke (required)"
        rows={3}
        style={{
          width: "100%",
          fontFamily: "inherit",
          fontSize: 14,
          padding: 8,
          border: "1px solid var(--rule)",
          borderRadius: 6,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onConfirm(reason.trim())}
          disabled={busy || !reason.trim()}
        >
          {busy ? "Revoking…" : "Revoke approval"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          maxWidth: 480,
          width: "100%",
          background: "var(--paper)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {children}
      </div>
    </div>
  );
}
