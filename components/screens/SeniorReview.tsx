"use client";

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { fetchTags, type Tag } from "@/lib/tags";
import { SeniorWeekDashboard } from "@/components/screens/SeniorWeekDashboard";
import {
  approveLocation,
  fetchLocationDetail,
  fetchLocationSummaries,
  postFeedback,
  revokeLocation,
  type FeedbackEvent,
  type LocationApprovalStatus,
  type LocationCampWeek,
  type LocationDetail,
  type LocationSummary,
} from "@/lib/location-approval";
import {
  parseSeniorReviewViewFromUrl,
  usePersistedView,
  writeSeniorReviewViewToUrl,
  type SeniorReviewView,
} from "@/lib/app-route";

type Filter = "all" | "awaiting" | "approved" | "revoked";

const STATUS_LABEL: Record<LocationApprovalStatus, string> = {
  unapproved: "Needs your review",
  approved: "Approved",
  reopened: "Awaiting re-review",
};

// Reopened locations re-enter the normal review flow; the "re-" prefix in
// the label is enough signal — no need for a rose/alarm tone.
const STATUS_TONE: Record<LocationApprovalStatus, string> = {
  unapproved: "var(--ink-3)",
  approved: "var(--moss)",
  reopened: "var(--ink-3)",
};

function statusMatchesFilter(status: LocationApprovalStatus, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "awaiting") return status === "unapproved";
  if (filter === "approved") return status === "approved";
  if (filter === "revoked") return status === "reopened";
  return true;
}

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
        onBack={() =>
          view.locationId
            ? setView({ kind: "location", locationId: view.locationId })
            : setView({ kind: "hub" })
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
  const [filter, setFilter] = React.useState<Filter>("all");
  const [error, setError] = React.useState<string | null>(null);

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

  const filtered = React.useMemo(
    () => (locations ?? []).filter((l) => statusMatchesFilter(l.approvalStatus, filter)),
    [locations, filter],
  );

  const total = locations?.length ?? 0;
  const approvedCount = (locations ?? []).filter((l) => l.approvalStatus === "approved").length;
  const awaitingCount = (locations ?? []).filter((l) => l.approvalStatus === "unapproved").length;
  const revokedCount = (locations ?? []).filter((l) => l.approvalStatus === "reopened").length;
  void toast;

  return (
    <>
      <PageHeader
        eyebrow="Lead review"
        title="Locations <em>this season</em>"
        sub={
          locations === null
            ? "Loading…"
            : `${total} location${total === 1 ? "" : "s"} · ${approvedCount} approved · ${awaitingCount} awaiting`
        }
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {error && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["all", `All (${total})`],
              ["awaiting", `Awaiting (${awaitingCount})`],
              ["approved", `Approved (${approvedCount})`],
              ["revoked", `Revoked (${revokedCount})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={"btn " + (filter === key ? "btn-primary" : "btn-ghost")}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {filtered.length === 0 && locations !== null && (
          <div className="card" style={{ color: "var(--ink-3)" }}>
            No locations match this filter.
          </div>
        )}

        {filtered.map((loc) => (
          <LocationRow key={loc.id} loc={loc} onOpen={() => onOpenLocation(loc.id)} />
        ))}
      </div>
    </>
  );
}

function LocationRow({ loc, onOpen }: { loc: LocationSummary; onOpen: () => void }) {
  const tone = STATUS_TONE[loc.approvalStatus];
  const label = STATUS_LABEL[loc.approvalStatus];
  const isApproved = loc.approvalStatus === "approved";
  const isReopened = loc.approvalStatus === "reopened";

  // Attribution line below the badge. Tells the lead WHO and WHEN, which
  // is the most common follow-up question after seeing the status label.
  let attribution: string | null = null;
  if (isApproved && loc.approvedAt) {
    attribution = `by ${loc.approvedByName ?? "—"} · ${relativeDate(loc.approvedAt)}`;
  } else if (isReopened && loc.revokedAt) {
    attribution = `Approval pulled back ${relativeDate(loc.revokedAt)}${loc.revokedByName ? ` by ${loc.revokedByName}` : ""}`;
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{loc.name}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {loc.divisionName}
            {loc.firstWeekStart && (
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

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        <span>{loc.totalPhotos} photos in eligible weeks</span>
        {loc.pendingCount > 0 && <span>{loc.pendingCount} pending</span>}
        {loc.flaggedCount > 0 && (
          <span style={{ color: "var(--rose)" }}>{loc.flaggedCount} flagged</span>
        )}
        {loc.lastFeedbackAt && (
          <span>
            Last feedback {relativeDate(loc.lastFeedbackAt)}
            {loc.lastFeedbackAuthor && <> by {loc.lastFeedbackAuthor}</>}
          </span>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          className={
            "btn " +
            (loc.approvalStatus === "unapproved" || loc.approvalStatus === "reopened"
              ? "btn-primary"
              : "btn-ghost")
          }
          onClick={onOpen}
        >
          {loc.approvalStatus === "approved" ? "View location" : "Open location"}
        </button>
      </div>
    </div>
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

  const handleFeedback = async (body: string, campWeekId: string | null, tagIds: string[]) => {
    try {
      await postFeedback(locationId, body, { campWeekId, tagIds });
      toast.show("Feedback added.");
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Feedback failed");
    }
  };

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

  const tone = STATUS_TONE[detail.approvalStatus];
  const statusLabel = STATUS_LABEL[detail.approvalStatus];

  return (
    <>
      <PageHeader
        eyebrow="Lead review"
        title={detail.name}
        sub={`${detail.divisionName}`}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <button type="button" className="btn btn-ghost" onClick={onBack} style={{ alignSelf: "flex-start" }}>
          ← All locations
        </button>

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

        <FeedbackSection
          events={feedback}
          weeks={weeks}
          weekSeniorTags={weekSeniorTags}
          onSubmit={handleFeedback}
        />

        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="page-eyebrow" style={{ margin: 0 }}>
            Camp weeks ({weeks.length})
          </h2>
          {weeks.length === 0 ? (
            <div className="card" style={{ color: "var(--ink-3)" }}>No camp weeks at this location.</div>
          ) : (
            weeks.map((w) => (
              <WeekRow key={w.id} week={w} onOpen={() => onOpenWeek(w.id)} />
            ))
          )}
        </section>
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

function WeekRow({ week, onOpen }: { week: LocationCampWeek; onOpen: () => void }) {
  const isEligible = week.triageRole !== "none";
  const reviewed = !!week.signoffAt;
  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
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
  );
}

// ─── Feedback feed + composer ─────────────────────────────────────────────────

function FeedbackSection({
  events,
  weeks,
  weekSeniorTags,
  onSubmit,
}: {
  events: FeedbackEvent[];
  weeks: LocationCampWeek[];
  weekSeniorTags: Tag[];
  onSubmit: (body: string, campWeekId: string | null, tagIds: string[]) => Promise<void>;
}) {
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [campWeekId, setCampWeekId] = React.useState<string>("");
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async () => {
    const text = body.trim();
    if (!text) return;
    setSubmitting(true);
    try {
      await onSubmit(text, campWeekId || null, selectedTagIds);
      setBody("");
      setCampWeekId("");
      setSelectedTagIds([]);
      setComposerOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="page-eyebrow" style={{ margin: 0 }}>
          Feedback ({events.length})
        </h2>
        {!composerOpen && (
          <button type="button" className="btn btn-ghost" onClick={() => setComposerOpen(true)}>
            Add feedback
          </button>
        )}
      </div>

      {composerOpen && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Note for the regional manager…"
            rows={4}
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={campWeekId}
              onChange={(e) => setCampWeekId(e.target.value)}
              style={{ padding: "6px 8px", border: "1px solid var(--rule)", borderRadius: 6 }}
            >
              <option value="">No specific week</option>
              {weeks
                .filter((w) => w.triageRole !== "none")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.startsOn})
                  </option>
                ))}
            </select>
            {weekSeniorTags.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {weekSeniorTags.map((t) => {
                  const on = selectedTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={"btn btn-ghost"}
                      style={{
                        fontSize: 11,
                        padding: "4px 8px",
                        background: on ? "var(--moss)" : undefined,
                        color: on ? "white" : undefined,
                      }}
                      onClick={() =>
                        setSelectedTagIds((prev) =>
                          on ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                        )
                      }
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setComposerOpen(false)} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || !body.trim()}
            >
              {submitting ? "Posting…" : "Post feedback"}
            </button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="card" style={{ color: "var(--ink-3)" }}>No feedback yet.</div>
      ) : (
        events.map((e) => <FeedbackRow key={e.id} event={e} />)
      )}
    </section>
  );
}

function FeedbackRow({ event }: { event: FeedbackEvent }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span>{event.authorName ?? "—"}</span>
        <span>·</span>
        <span>{new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        {event.campWeekName && (
          <>
            <span>·</span>
            <span>{event.campWeekName}</span>
          </>
        )}
      </div>
      <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{event.body}</div>
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
