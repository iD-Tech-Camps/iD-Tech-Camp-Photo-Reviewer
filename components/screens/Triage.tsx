"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PhotoImg } from "@/components/PhotoImg";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import {
  fetchActiveClaimsForReviewer,
  fetchClaimPhotos,
  fetchWeekContext,
  type ActiveClaim,
  type ClaimPhoto,
} from "@/lib/triage-claims";
import { fetchTriageHubWeeks, fetchWeekPendingCount, type TriageHubWeek } from "@/lib/triage-hub";
import {
  campQualityHubStatusLabel,
  isCampQualityAwaitingLeadReview,
} from "@/lib/triage-hub-display";
import { todayYmdLocal } from "@/lib/review-hub-sections";
import { ReviewHubWeekSections } from "@/components/ReviewHubWeekSections";
import { SeniorWeekDashboard } from "@/components/screens/SeniorWeekDashboard";
import {
  buildTagLabelLookup,
  fetchTags,
  type Tag,
} from "@/lib/tags";
import { BatchPointsHud } from "@/components/BatchPointsHud";
import { useFinishBatchFlow } from "@/components/FinishBatchFlow";
import { celebrateReviewBump } from "@/lib/review-points-celebration";
import { usePoints } from "@/lib/points-context";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";
import { fetchTriageConfig } from "@/lib/triage-config";
import {
  parseTriageViewFromUrl,
  usePersistedView,
  writeTriageViewToUrl,
  type TriageView,
} from "@/lib/app-route";

type View = TriageView;

// User-facing labels for the DB's triage_role enum.
const WEEK_ROLE_LABEL: Record<string, string> = {
  none: "",
  first_week: "First week",
  second_week_recheck: "Follow-up review",
};

const REVIEW_KIND_LABEL: Record<string, string> = {
  clean: "no issues",
  flag: "flagged",
};

export function TriageApp({ toast }: { toast: ToastApi }) {
  const user = useCurrentUser();
  const userId = user.id;
  const role = user.role;
  const supabase = React.useMemo(() => createClient(), []);
  const parseView = React.useCallback(() => parseTriageViewFromUrl(), []);
  const writeView = React.useCallback((v: View) => writeTriageViewToUrl(v), []);
  const [view, setView] = usePersistedView(parseView, writeView, { kind: "hub" });
  const [weeks, setWeeks] = React.useState<TriageHubWeek[] | null>(null);
  const [claims, setClaims] = React.useState<ActiveClaim[]>([]);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [weekSeniorTags, setWeekSeniorTags] = React.useState<Tag[]>([]);
  // Admin-controlled cap for the "Start a batch" path. Null until the
  // triage_config row loads; the button disables itself while loading so a
  // stale default never leaks into a claim's slice_size.
  const [batchSize, setBatchSize] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const reloadHub = React.useCallback(async () => {
    if (!userId) return;
    const [w, c, t, wt, cfg] = await Promise.all([
      fetchTriageHubWeeks(supabase),
      fetchActiveClaimsForReviewer(supabase, userId),
      fetchTags(supabase, { purpose: "quality_flag" }),
      fetchTags(supabase, { purpose: "week_senior" }),
      fetchTriageConfig(supabase),
    ]);
    setWeeks(w);
    setClaims(c);
    setTags(t);
    setWeekSeniorTags(wt);
    setBatchSize(cfg.batchSize);
  }, [supabase, userId]);

  React.useEffect(() => {
    let cancelled = false;
    reloadHub()
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message ?? "Failed to load review hub");
      });
    return () => { cancelled = true; };
  }, [reloadHub]);

  const openClaim = async (campWeekId: string, sliceSize: number) => {
    try {
      const res = await fetch("/api/triage/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camp_week_id: campWeekId, slice_size: sliceSize }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't start batch");
      setView({ kind: "claim", claimId: json.claim.id, campWeekId });
      await reloadHub();
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Couldn't start batch", "x");
    }
  };

  if (view.kind === "claim") {
    return (
      <ClaimGrid
        toast={toast}
        supabase={supabase}
        claimId={view.claimId}
        campWeekId={view.campWeekId}
        tags={tags}
        onBack={() => { setView({ kind: "hub" }); void reloadHub(); }}
        onStartAnotherBatch={async () => {
          const n = await fetchWeekPendingCount(supabase, view.campWeekId);
          if (n === 0) {
            setView({ kind: "hub" });
            await reloadHub();
            toast.show("No more photos pending for this week", "check");
            return;
          }
          const size =
            batchSize === null
              ? Math.max(1, n)
              : Math.max(1, Math.min(batchSize, n));
          await openClaim(view.campWeekId, size);
        }}
      />
    );
  }

  if (view.kind === "senior") {
    return (
      <SeniorWeekDashboard
        toast={toast}
        supabase={supabase}
        campWeekId={view.campWeekId}
        tags={tags}
        weekSeniorTags={weekSeniorTags}
        onBack={() => { setView({ kind: "hub" }); void reloadHub(); }}
      />
    );
  }

  const labelLookup = buildTagLabelLookup(tags);
  const today = todayYmdLocal();

  return (
    <>
      <PageHeader
        eyebrow="Camp Quality Review"
        title="Camp weeks <em>needing review</em>"
        sub={claims.length > 0 ? `${claims.length} active batch${claims.length === 1 ? "" : "es"}` : "Pick a week to start a batch"}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {loadError && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{loadError}</div>}

        {claims.length > 0 && (
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Your active batches</h3>
            {claims.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn-ghost"
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}
                onClick={() => setView({ kind: "claim", claimId: c.id, campWeekId: c.campWeekId })}
              >
                Resume batch · {c.sliceSize} photos
              </button>
            ))}
          </div>
        )}

        <ReviewHubWeekSections
          weeks={weeks}
          emptyMessage="No camp weeks need review right now."
          renderWeek={(w, section) => {
            const awaitingLead = isCampQualityAwaitingLeadReview(w.triageState);
            const weekStarted = w.startsOn <= today;

            return (
            <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{w.locationName} — {w.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {section === "upcoming"
                    ? [
                        WEEK_ROLE_LABEL[w.triageRole] || w.triageRole,
                        weekStarted ? "Awaiting photos" : `Starts ${w.startsOn}`,
                      ].filter(Boolean).join(" · ")
                    : [
                        WEEK_ROLE_LABEL[w.triageRole] || w.triageRole,
                        campQualityHubStatusLabel(w.triageState),
                        awaitingLead ? null : `${w.pendingCount} pending`,
                      ].filter(Boolean).join(" · ")}
                </div>
              </div>
              {section === "active" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!awaitingLead && (
                    <>
                  {(() => {
                    const startSize = batchSize === null
                      ? Math.max(1, w.pendingCount)
                      : Math.max(1, Math.min(batchSize, w.pendingCount));
                    return (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => openClaim(w.id, startSize)}
                        disabled={w.pendingCount === 0 || batchSize === null}
                      >
                        Start a batch ({w.pendingCount === 0 ? 0 : startSize})
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={async () => {
                      const n = await fetchWeekPendingCount(supabase, w.id);
                      void openClaim(w.id, Math.max(1, n));
                    }}
                    disabled={w.pendingCount === 0}
                  >
                    Whole week
                  </button>
                    </>
                  )}
                  {(role === "senior" || role === "admin") &&
                    awaitingLead && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setView({ kind: "senior", campWeekId: w.id })}
                    >
                      Lead review
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          }}
        />
      </div>
    </>
  );
}

type ReviewKind = "clean" | "flag";
type ReviewSnapshot = {
  kind: ReviewKind;
  tagIds: string[];
  quarantineIntent: boolean;
};

function ClaimGrid({
  toast,
  supabase,
  claimId,
  campWeekId,
  tags,
  onBack,
  onStartAnotherBatch,
}: {
  toast: ToastApi;
  supabase: ReturnType<typeof createClient>;
  claimId: string;
  campWeekId: string;
  tags: Tag[];
  onBack: () => void;
  onStartAnotherBatch: () => Promise<void>;
}) {
  const [photos, setPhotos] = React.useState<ClaimPhoto[]>([]);
  const [ctx, setCtx] = React.useState<{ weekName: string; locationName: string; evergreenNotes: string | null } | null>(null);
  // Local-only review map. The DB trigger nulls triage_claim_id once an
  // event lands, so a re-fetch would drop the photo from the grid mid-
  // session; tracking decisions here keeps the grid stable until release.
  // Stores the full submission (kind + tags + quarantine) so re-opening a
  // reviewed photo restores its prior state.
  const [reviewed, setReviewed] = React.useState<Record<string, ReviewSnapshot>>({});
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [batchReviewCount, setBatchReviewCount] = React.useState(0);
  const [lastEarned, setLastEarned] = React.useState<number | null>(null);
  const { bumpAfterReviewEvent, eventCount } = usePoints();

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [p, c] = await Promise.all([
        fetchClaimPhotos(supabase, claimId),
        fetchWeekContext(supabase, campWeekId),
      ]);
      if (cancelled) return;
      setPhotos(p);
      setCtx(c);
    })();
    return () => { cancelled = true; };
  }, [supabase, claimId, campWeekId]);

  // Preload neighbors of the current lightbox photo so arrow nav lands on
  // an already-cached image. The lightbox renders the XL variant (rewritten
  // from thumbnail_url), so that's what we prefetch — never the original
  // ArchivedUri, which can be multi-MB and would make ±2 preloading worse
  // than the bug we're fixing. If the rewrite fails for a given neighbor
  // (URL doesn't match the SmugMug pattern), skip it.
  React.useEffect(() => {
    if (lightboxIndex === null) return;
    const offsets = [-2, -1, 1, 2];
    for (const off of offsets) {
      const idx = lightboxIndex + off;
      if (idx < 0 || idx >= photos.length) continue;
      const p = photos[idx];
      if (!p?.thumbnailUrl) continue;
      const xl = smugmugVariantUrl(p.thumbnailUrl, "XL");
      if (!xl) continue;
      const img = new window.Image();
      img.src = xl;
    }
  }, [lightboxIndex, photos]);

  const total = photos.length;
  const reviewedCount = photos.reduce((n, p) => n + (reviewed[p.id] ? 1 : 0), 0);
  const weekLabel = ctx ? `${ctx.locationName} — ${ctx.weekName}` : "";
  const finishBatch = useFinishBatchFlow({
    releaseUrl: `/api/triage/claims/${claimId}/release`,
    reviewedCount,
    total,
    weekLabel,
    onBackToHub: onBack,
    onStartAnotherBatch,
    toast,
  });

  const findNextUnreviewed = (from: number, map: Record<string, ReviewSnapshot>): number | null => {
    for (let i = from + 1; i < photos.length; i++) if (!map[photos[i].id]) return i;
    for (let i = 0; i < from; i++) if (!map[photos[i].id]) return i;
    return null;
  };

  const submit = async (
    photoId: string,
    tagIds: string[],
    quarantineIntent: boolean,
  ): Promise<ReviewSnapshot | null> => {
    // Tags drive the decision: no tags = clean, any tags = flag. The DB
    // check constraint forces quarantine_intent=false on clean events, so
    // we send it that way explicitly.
    const kind: ReviewKind = tagIds.length === 0 ? "clean" : "flag";
    const effectiveQuarantine = kind === "flag" ? quarantineIntent : false;
    try {
      const res = await fetch("/api/triage/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: photoId,
          claim_id: claimId,
          kind,
          tag_ids: tagIds,
          quarantine_intent: effectiveQuarantine,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submit failed");
      const snapshot: ReviewSnapshot = { kind, tagIds, quarantineIntent: effectiveQuarantine };
      setReviewed((m) => ({ ...m, [photoId]: snapshot }));
      const prevLifetime = eventCount ?? 0;
      const bump = bumpAfterReviewEvent("triage_event");
      const nextBatch = batchReviewCount + 1;
      setBatchReviewCount(nextBatch);
      if (bump) {
        setLastEarned(bump.earned);
        celebrateReviewBump(prevLifetime, bump, nextBatch, toast.show);
      }
      return snapshot;
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Submit failed", "x");
      return null;
    }
  };

  if (!ctx) return <div className="page-body">Loading batch…</div>;

  const lightboxPhoto = lightboxIndex !== null ? photos[lightboxIndex] ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="Camp Quality Review · Batch"
        title={`${ctx.locationName} — ${ctx.weekName}`}
        sub={`${reviewedCount} of ${total} reviewed`}
      />
      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20 }}>
        <aside className="card" style={{ fontSize: 13 }}>
          <button type="button" className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}>← Back</button>
          {ctx.evergreenNotes && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Location notes</div>
              <p style={{ color: "var(--ink-2)", lineHeight: 1.5 }}>{ctx.evergreenNotes}</p>
            </>
          )}
          {lightboxIndex === null && (
            <BatchPointsHud variant="sidebar" lastEarned={lastEarned} />
          )}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className={finishBatch.allDone ? "btn btn-primary" : "btn btn-ghost"}
              onClick={() => finishBatch.clickFinish()}
              disabled={finishBatch.busy}
            >
              {finishBatch.busy ? "Finishing…" : "Finish batch"}
            </button>
          </div>
        </aside>

        <div>
          {photos.length === 0 ? (
            <div className="card">No photos in this batch.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {photos.map((p, idx) => {
                const snapshot = reviewed[p.id];
                const kind = snapshot?.kind;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    aria-label={`Photo ${idx + 1} of ${total}${kind ? `, marked ${REVIEW_KIND_LABEL[kind]}` : ""}`}
                    style={{
                      position: "relative",
                      aspectRatio: "4 / 3",
                      padding: 0,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: kind === "clean"
                        ? "2px solid var(--moss)"
                        : kind === "flag"
                        ? "2px solid var(--rose)"
                        : "1px solid var(--rule)",
                      background: "var(--paper-3)",
                      cursor: "pointer",
                    }}
                  >
                    <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
                    {kind && (
                      <>
                        <div
                          aria-hidden
                          style={{
                            position: "absolute", inset: 0,
                            background: "rgba(0,0,0,0.35)",
                          }}
                        />
                        <div
                          aria-hidden
                          style={{
                            position: "absolute", top: 8, right: 8,
                            width: 28, height: 28, borderRadius: 999,
                            background: kind === "clean" ? "var(--moss)" : "var(--rose)",
                            color: "white",
                            display: "grid", placeItems: "center",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                          }}
                        >
                          <Icon name={kind === "clean" ? "check" : "flag"} size={16} />
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {lightboxIndex !== null && (
        <BatchPointsHud variant="overlay" lastEarned={lastEarned} />
      )}

      {finishBatch.dialog}

      {lightboxPhoto && lightboxIndex !== null && (
        <Lightbox
          photo={lightboxPhoto}
          tags={tags}
          position={`${lightboxIndex + 1} / ${total}`}
          snapshot={reviewed[lightboxPhoto.id]}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < total - 1}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null || i <= 0 ? i : i - 1))}
          onNext={() => setLightboxIndex((i) => (i === null || i >= total - 1 ? i : i + 1))}
          onSubmit={async (tagIds, quarantineIntent) => {
            const result = await submit(lightboxPhoto.id, tagIds, quarantineIntent);
            if (!result) return;
            const nextMap = { ...reviewed, [lightboxPhoto.id]: result };
            const next = findNextUnreviewed(lightboxIndex, nextMap);
            if (next !== null) setLightboxIndex(next);
          }}
        />
      )}
    </>
  );
}

function Lightbox({
  photo,
  tags,
  position,
  snapshot,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
  onSubmit,
}: {
  photo: ClaimPhoto;
  tags: Tag[];
  position: string;
  snapshot: ReviewSnapshot | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: (tagIds: string[], quarantineIntent: boolean) => Promise<void>;
}) {
  const [selectedTags, setSelectedTags] = React.useState<string[]>(snapshot?.tagIds ?? []);
  const [quarantineIntent, setQuarantineIntent] = React.useState<boolean>(snapshot?.quarantineIntent ?? false);
  const [busy, setBusy] = React.useState(false);

  // Re-seed state when the lightbox swaps photos: pre-fill if the user has
  // already submitted this photo (so they can see and edit their prior
  // tags / quarantine choice), otherwise reset to empty.
  React.useEffect(() => {
    setSelectedTags(snapshot?.tagIds ?? []);
    setQuarantineIntent(snapshot?.quarantineIntent ?? false);
  }, [photo.id, snapshot]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      // Don't hijack arrows while the user is typing in the note field
      // (no note field yet, but keep the guard so future inputs work).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(selectedTags, quarantineIntent);
    } finally {
      setBusy(false);
    }
  };

  const willFlag = selectedTags.length > 0;
  const submitLabel = snapshot ? "Update" : "Submit";

  // Rewrite the cached thumbnail URL to the XL variant (~150-400 KB) for
  // the hero. Fall back to the original archive (multi-MB) if the rewrite
  // can't match the URL pattern, and to the thumbnail itself if there's
  // no archive either. The thumbnail is already in the browser cache from
  // the grid, so previewSrc paints instantly under the loading XL.
  const xlUrl = photo.thumbnailUrl ? smugmugVariantUrl(photo.thumbnailUrl, "XL") : null;
  const heroSrc = xlUrl ?? photo.imageUrl ?? photo.thumbnailUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.86)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          position: "absolute", top: 20, left: 24,
          color: "white",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {position}{snapshot ? ` · ${REVIEW_KIND_LABEL[snapshot.kind]}` : ""}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute", top: 16, right: 16,
          width: 40, height: 40, borderRadius: 999,
          background: "rgba(255,255,255,0.12)", color: "white",
          border: "none", cursor: "pointer",
          display: "grid", placeItems: "center",
        }}
      >
        <Icon name="x" size={20} />
      </button>

      {hasPrev && (
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous photo"
          style={{
            position: "absolute", top: "50%", left: 16, transform: "translateY(-50%)",
            width: 48, height: 48, borderRadius: 999,
            background: "rgba(255,255,255,0.12)", color: "white",
            border: "none", cursor: "pointer",
            display: "grid", placeItems: "center",
          }}
        >
          <Icon name="arrow-l" size={22} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={onNext}
          aria-label="Next photo"
          style={{
            position: "absolute", top: "50%", right: 16, transform: "translateY(-50%)",
            width: 48, height: 48, borderRadius: 999,
            background: "rgba(255,255,255,0.12)", color: "white",
            border: "none", cursor: "pointer",
            display: "grid", placeItems: "center",
          }}
        >
          <Icon name="arrow-r" size={22} />
        </button>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex", flexDirection: "column", gap: 16,
          maxWidth: 1100, width: "100%", maxHeight: "100%",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "62vh",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <PhotoImg
            src={heroSrc}
            previewSrc={photo.thumbnailUrl}
            alt={photo.caption ?? "Photo"}
            fit="contain"
            loading="eager"
            background="transparent"
            showSpinner
          />
        </div>

        <div
          style={{
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                className={"btn " + (selectedTags.includes(t.id) ? "btn-primary" : "btn-ghost")}
                onClick={() =>
                  setSelectedTags((s) =>
                    s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id],
                  )
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <label
            style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13,
              opacity: willFlag ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={quarantineIntent}
              onChange={(e) => setQuarantineIntent(e.target.checked)}
              disabled={!willFlag}
            />
            Hide from parent view (only applies when an issue is selected)
          </label>
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void handle()}
            >
              {submitLabel}
            </button>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {willFlag
                ? `Flag ${selectedTags.length} issue${selectedTags.length === 1 ? "" : "s"}`
                : "No issues selected → no issues"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
