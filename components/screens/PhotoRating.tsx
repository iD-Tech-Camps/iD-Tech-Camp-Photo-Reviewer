"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PhotoImg } from "@/components/PhotoImg";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import {
  fetchActiveRatingClaimsForReviewer,
  fetchLatestRatingEventsForClaim,
  fetchRatingClaimPhotos,
  fetchRatingWeekContext,
  type RatingClaimPhoto,
  type RatingEventSnapshot,
} from "@/lib/photo-rating-claims";
import {
  fetchPhotoRatingHubWeeks,
  fetchRatingWeekPendingCount,
  type PhotoRatingHubWeek,
} from "@/lib/photo-rating-hub";
import { buildTagLabelLookup, fetchTags, type Tag } from "@/lib/tags";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";
import { BatchPointsHud } from "@/components/BatchPointsHud";
import { celebrateReviewBump } from "@/lib/review-points-celebration";
import { usePoints } from "@/lib/points-context";
import { fetchTriageConfig } from "@/lib/triage-config";

type View =
  | { kind: "hub" }
  | { kind: "claim"; claimId: string; campWeekId: string };

const WEEK_STATE_LABEL: Record<string, string> = {
  not_required: "Not in season",
  awaiting_photos: "Awaiting photos",
  photos_in: "Not started",
  rating_in_progress: "In review",
  rating_done: "All photos rated",
  complete: "Done",
};

const WEEK_ROLE_LABEL: Record<string, string> = {
  none: "",
  first_week: "First week",
  second_week_recheck: "Follow-up review",
};

export function PhotoRatingApp({ toast }: { toast: ToastApi }) {
  const user = useCurrentUser();
  const userId = user.id;
  const supabase = React.useMemo(() => createClient(), []);
  const [view, setView] = React.useState<View>({ kind: "hub" });
  const [weeks, setWeeks] = React.useState<PhotoRatingHubWeek[] | null>(null);
  const [claims, setClaims] = React.useState<Awaited<ReturnType<typeof fetchActiveRatingClaimsForReviewer>>>([]);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [batchSize, setBatchSize] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const reloadHub = React.useCallback(async () => {
    if (!userId) return;
    const [w, c, t, cfg] = await Promise.all([
      fetchPhotoRatingHubWeeks(supabase),
      fetchActiveRatingClaimsForReviewer(supabase, userId),
      fetchTags(supabase, { purpose: "photo_rating" }),
      fetchTriageConfig(supabase),
    ]);
    setWeeks(w);
    setClaims(c);
    setTags(t);
    setBatchSize(cfg.batchSize);
  }, [supabase, userId]);

  React.useEffect(() => {
    let cancelled = false;
    reloadHub()
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message ?? "Failed to load photo review hub");
      });
    return () => { cancelled = true; };
  }, [reloadHub]);

  const openClaim = async (campWeekId: string, sliceSize: number) => {
    try {
      const res = await fetch("/api/photo-rating/claims", {
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
      <RatingClaimGrid
        toast={toast}
        supabase={supabase}
        userId={userId!}
        claimId={view.claimId}
        campWeekId={view.campWeekId}
        tags={tags}
        onBack={() => { setView({ kind: "hub" }); void reloadHub(); }}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Camp Photo Review"
        title="Camp weeks <em>to rate</em>"
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

        {(weeks ?? []).map((w) => (
          <div key={w.id} className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{w.locationName} — {w.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {[
                  WEEK_ROLE_LABEL[w.ratingRole] || w.ratingRole,
                  WEEK_STATE_LABEL[w.ratingState] || w.ratingState,
                  `${w.pendingCount} pending`,
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  const n = await fetchRatingWeekPendingCount(supabase, w.id);
                  void openClaim(w.id, Math.max(1, n));
                }}
                disabled={w.pendingCount === 0}
              >
                Whole week
              </button>
            </div>
          </div>
        ))}

        {weeks !== null && weeks.length === 0 && (
          <div className="card" style={{ color: "var(--ink-3)" }}>No camp weeks need photo review right now.</div>
        )}
      </div>
    </>
  );
}

function RatingClaimGrid({
  toast,
  supabase,
  userId,
  claimId,
  campWeekId,
  tags,
  onBack,
}: {
  toast: ToastApi;
  supabase: ReturnType<typeof createClient>;
  userId: string;
  claimId: string;
  campWeekId: string;
  tags: Tag[];
  onBack: () => void;
}) {
  const [photos, setPhotos] = React.useState<RatingClaimPhoto[]>([]);
  const [ctx, setCtx] = React.useState<{ weekName: string; locationName: string; evergreenNotes: string | null } | null>(null);
  const [reviewed, setReviewed] = React.useState<Record<string, RatingEventSnapshot>>({});
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [batchReviewCount, setBatchReviewCount] = React.useState(0);
  const [lastEarned, setLastEarned] = React.useState<number | null>(null);
  const { bumpAfterReviewEvent, eventCount } = usePoints();

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [p, c, prior] = await Promise.all([
        fetchRatingClaimPhotos(supabase, claimId),
        fetchRatingWeekContext(supabase, campWeekId),
        fetchLatestRatingEventsForClaim(supabase, claimId, userId),
      ]);
      if (cancelled) return;
      setPhotos(p);
      setCtx(c);
      const map: Record<string, RatingEventSnapshot> = {};
      for (const [photoId, snap] of prior) map[photoId] = snap;
      setReviewed(map);
    })();
    return () => { cancelled = true; };
  }, [supabase, claimId, campWeekId, userId]);

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
  const allDone = total > 0 && reviewedCount === total;

  const findNextUnreviewed = (from: number, map: Record<string, RatingEventSnapshot>): number | null => {
    for (let i = from + 1; i < photos.length; i++) if (!map[photos[i].id]) return i;
    for (let i = 0; i < from; i++) if (!map[photos[i].id]) return i;
    return null;
  };

  const submit = async (
    photoId: string,
    rating: number,
    tagIds: string[],
    quarantineIntent: boolean,
  ): Promise<RatingEventSnapshot | null> => {
    try {
      const res = await fetch("/api/photo-rating/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: photoId,
          claim_id: claimId,
          rating,
          tag_ids: tagIds,
          quarantine_intent: quarantineIntent,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submit failed");
      const snapshot: RatingEventSnapshot = { rating, tagIds, quarantineIntent };
      setReviewed((m) => ({ ...m, [photoId]: snapshot }));
      const prevLifetime = eventCount ?? 0;
      const bump = bumpAfterReviewEvent("photo_rating_event");
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

  const dropBatch = async () => {
    await fetch(`/api/photo-rating/claims/${claimId}/release`, { method: "POST" });
    if (allDone) toast.show("Batch complete", "check");
    onBack();
  };

  if (!ctx) return <div className="page-body">Loading batch…</div>;

  const lightboxPhoto = lightboxIndex !== null ? photos[lightboxIndex] ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="Camp Photo Review · Batch"
        title={`${ctx.locationName} — ${ctx.weekName}`}
        sub={`${reviewedCount} of ${total} rated`}
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
            <button type="button" className="btn btn-ghost" onClick={() => void dropBatch()}>
              Drop batch
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
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    aria-label={`Photo ${idx + 1} of ${total}${snapshot ? `, rated ${snapshot.rating} stars` : ""}`}
                    style={{
                      position: "relative",
                      aspectRatio: "4 / 3",
                      padding: 0,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: snapshot
                        ? "2px solid var(--sun)"
                        : "1px solid var(--rule)",
                      background: "var(--paper-3)",
                      cursor: "pointer",
                    }}
                  >
                    <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
                    {snapshot && (
                      <>
                        <div
                          aria-hidden
                          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}
                        />
                        <div
                          aria-hidden
                          style={{
                            position: "absolute", top: 8, right: 8,
                            padding: "4px 8px", borderRadius: 999,
                            background: "var(--sun)", color: "white",
                            fontSize: 12, fontWeight: 600,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                          }}
                        >
                          {snapshot.rating}★
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

      {lightboxPhoto && lightboxIndex !== null && (
        <RatingLightbox
          photo={lightboxPhoto}
          tags={tags}
          position={`${lightboxIndex + 1} / ${total}`}
          snapshot={reviewed[lightboxPhoto.id]}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < total - 1}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null || i <= 0 ? i : i - 1))}
          onNext={() => setLightboxIndex((i) => (i === null || i >= total - 1 ? i : i + 1))}
          onSubmit={async (rating, tagIds, quarantineIntent) => {
            const result = await submit(lightboxPhoto.id, rating, tagIds, quarantineIntent);
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

function RatingLightbox({
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
  photo: RatingClaimPhoto;
  tags: Tag[];
  position: string;
  snapshot: RatingEventSnapshot | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: (rating: number, tagIds: string[], quarantineIntent: boolean) => Promise<void>;
}) {
  const [rating, setRating] = React.useState<number>(snapshot?.rating ?? 0);
  const [selectedTags, setSelectedTags] = React.useState<string[]>(snapshot?.tagIds ?? []);
  const [quarantineIntent, setQuarantineIntent] = React.useState<boolean>(snapshot?.quarantineIntent ?? false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setRating(snapshot?.rating ?? 0);
    setSelectedTags(snapshot?.tagIds ?? []);
    setQuarantineIntent(snapshot?.quarantineIntent ?? false);
  }, [photo.id, snapshot]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
      else if (e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        setRating(Number(e.key));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const handle = async () => {
    if (busy || rating < 1 || rating > 5) return;
    setBusy(true);
    try {
      await onSubmit(rating, selectedTags, quarantineIntent);
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = snapshot ? "Update" : "Submit";
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
        {position}{snapshot ? ` · ${snapshot.rating} stars` : ""}
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
          <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600 }}>Rating (required)</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={"btn " + (rating >= n ? "btn-primary" : "btn-ghost")}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                style={{ minWidth: 44 }}
              >
                <Icon name="stars" size={18} />
                <span style={{ marginLeft: 4 }}>{n}</span>
              </button>
            ))}
          </div>

          {tags.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tags (optional)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
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
            </>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={quarantineIntent}
              onChange={(e) => setQuarantineIntent(e.target.checked)}
            />
            Hide from parent view
          </label>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || rating < 1}
              onClick={() => void handle()}
            >
              {submitLabel}
            </button>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {rating < 1 ? "Select a star rating to submit" : `${rating} star${rating === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
