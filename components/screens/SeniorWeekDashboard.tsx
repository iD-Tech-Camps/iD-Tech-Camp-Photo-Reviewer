"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PhotoImg } from "@/components/PhotoImg";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCategoryRollup,
  fetchSeniorWeek,
  fetchWeekPhotosForSenior,
  type SeniorWeekPhoto,
  type SeniorWeekSummary,
} from "@/lib/triage-senior";
import { signoffCampWeek, setPositiveAssessment } from "@/lib/triage-signoff";
import {
  fetchCampWeekSeniorTagIds,
  setCampWeekSeniorTags,
} from "@/lib/photo-rating-senior";
import {
  buildTagLabelLookup,
  groupTagsByValence,
  TAG_CATEGORY_LABELS,
  type Tag,
  type TagCategory,
  type TagValence,
} from "@/lib/tags";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";

const WEEK_STATE_LABEL: Record<string, string> = {
  not_required: "Not in season",
  awaiting_photos: "Awaiting photos",
  photos_in: "Not started",
  triage_in_progress: "In review",
  triage_done: "Ready for sign-off",
  senior_review: "In sign-off",
  complete: "Approved",
};

type PhotoFilter = "all" | "issues" | "hidden";

function formatReviewedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function photoBorder(state: string): string {
  if (state === "flagged") return "2px solid var(--rose)";
  if (state === "clean") return "2px solid var(--moss)";
  if (state === "deleted") return "2px solid var(--ink-3)";
  return "1px solid var(--rule)";
}

function matchesFilter(p: SeniorWeekPhoto, filter: PhotoFilter): boolean {
  if (filter === "issues") return p.triageState === "flagged";
  if (filter === "hidden") return p.isQuarantined;
  return true;
}

export function SeniorWeekDashboard({
  toast,
  supabase,
  campWeekId,
  tags,
  weekSeniorTags,
  onBack,
}: {
  toast: ToastApi;
  supabase: ReturnType<typeof createClient>;
  campWeekId: string;
  tags: Tag[];
  weekSeniorTags: Tag[];
  onBack: () => void;
}) {
  const [week, setWeek] = React.useState<SeniorWeekSummary | null>(null);
  const [photos, setPhotos] = React.useState<SeniorWeekPhoto[]>([]);
  const [rollup, setRollup] = React.useState<Record<TagCategory, number> | null>(null);
  const [recheck, setRecheck] = React.useState(false);
  const [selectedWeekTags, setSelectedWeekTags] = React.useState<string[]>([]);
  const [weekTagsBusy, setWeekTagsBusy] = React.useState(false);
  const [photoFilter, setPhotoFilter] = React.useState<PhotoFilter>("all");
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [finishConfirmOpen, setFinishConfirmOpen] = React.useState(false);
  const [finishBusy, setFinishBusy] = React.useState(false);
  const labelLookup = buildTagLabelLookup(tags);

  const isComplete = week?.triageState === "complete";
  const readOnly = isComplete;

  const reload = React.useCallback(async () => {
    const [w, p, r, weekTagIds] = await Promise.all([
      fetchSeniorWeek(supabase, campWeekId),
      fetchWeekPhotosForSenior(supabase, campWeekId),
      fetchCategoryRollup(supabase, campWeekId),
      fetchCampWeekSeniorTagIds(supabase, campWeekId),
    ]);
    setWeek(w);
    setPhotos(p);
    setRollup(r);
    setSelectedWeekTags(weekTagIds);
    setRecheck(false);
    if (p.some((photo) => photo.triageState === "flagged")) {
      setPhotoFilter("issues");
    } else {
      setPhotoFilter("all");
    }
  }, [supabase, campWeekId]);

  React.useEffect(() => { void reload(); }, [reload]);

  const filteredPhotos = React.useMemo(
    () => photos.filter((p) => matchesFilter(p, photoFilter)),
    [photos, photoFilter],
  );

  const togglePositive = async (
    field: "positiveGreatQuality" | "positiveGreatVariety" | "positiveShininessGreat",
    value: boolean,
  ) => {
    if (!week || readOnly) return;
    const next = {
      greatQuality: field === "positiveGreatQuality" ? value : week.positiveGreatQuality,
      greatVariety: field === "positiveGreatVariety" ? value : week.positiveGreatVariety,
      shininessGreat: field === "positiveShininessGreat" ? value : week.positiveShininessGreat,
    };
    try {
      await setPositiveAssessment(
        supabase, campWeekId, next.greatQuality, next.greatVariety, next.shininessGreat,
      );
      await reload();
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Update failed", "x");
    }
  };

  const seniorAction = async (photoId: string, kind: string) => {
    setActionBusy(true);
    try {
      const res = await fetch("/api/triage/events/senior", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId, kind }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      await reload();
      toast.show("Photo updated", "check");
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Action failed", "x");
    } finally {
      setActionBusy(false);
    }
  };

  const signoff = async () => {
    if (readOnly) return;
    setFinishBusy(true);
    try {
      await signoffCampWeek(supabase, campWeekId);
      toast.show("Week marked as reviewed.", "check");
      setFinishConfirmOpen(false);
      await reload();
    } catch (err: unknown) {
      // Translate the most common legacy error before showing.
      const raw = err instanceof Error ? err.message : "Couldn't finish review";
      const friendly = raw.includes("not eligible for signoff")
        ? "This week isn't ready to finish — make sure every photo has been reviewed first."
        : raw;
      toast.show(friendly, "x");
    } finally {
      setFinishBusy(false);
    }
  };

  const toggleWeekTag = async (tagId: string) => {
    if (readOnly) return;
    const next = selectedWeekTags.includes(tagId)
      ? selectedWeekTags.filter((id) => id !== tagId)
      : [...selectedWeekTags, tagId];
    setWeekTagsBusy(true);
    try {
      await setCampWeekSeniorTags(supabase, campWeekId, next);
      setSelectedWeekTags(next);
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Couldn't update week tags", "x");
    } finally {
      setWeekTagsBusy(false);
    }
  };

  const openPhoto = (photoId: string) => {
    const idx = filteredPhotos.findIndex((p) => p.id === photoId);
    if (idx >= 0) setLightboxIndex(idx);
  };

  React.useEffect(() => {
    if (lightboxIndex === null) return;
    if (lightboxIndex >= filteredPhotos.length) {
      setLightboxIndex(filteredPhotos.length > 0 ? filteredPhotos.length - 1 : null);
    }
  }, [filteredPhotos.length, lightboxIndex]);

  React.useEffect(() => {
    if (lightboxIndex === null) return;
    const preload = (url: string | null) => {
      if (!url) return;
      const img = new Image();
      img.src = smugmugVariantUrl(url, "L") ?? url;
    };
    for (const off of [-1, 1]) {
      const idx = lightboxIndex + off;
      if (idx >= 0 && idx < filteredPhotos.length) {
        preload(filteredPhotos[idx]?.imageUrl ?? filteredPhotos[idx]?.thumbnailUrl ?? null);
      }
    }
  }, [lightboxIndex, filteredPhotos]);

  if (!week || !rollup) return <div className="page-body">Loading review dashboard…</div>;

  const lightboxPhoto = lightboxIndex !== null ? filteredPhotos[lightboxIndex] ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="Lead review · Camp week"
        title={`${week.locationName} — ${week.name}`}
        sub={WEEK_STATE_LABEL[week.triageState] ?? week.triageState}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>← Back</button>

        {week.evergreenNotes && (
          <div className="card" style={{ fontSize: 13, color: "var(--ink-2)" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Location notes</div>
            <p style={{ margin: 0, lineHeight: 1.5 }}>{week.evergreenNotes}</p>
          </div>
        )}

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Week report</h3>

          <section>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Highlights</div>
            {[
              ["Great Quality", "positiveGreatQuality", week.positiveGreatQuality],
              ["Great Variety", "positiveGreatVariety", week.positiveGreatVariety],
              ["Shininess Looks Great", "positiveShininessGreat", week.positiveShininessGreat],
            ].map(([label, field, checked]) => (
              <label key={field as string} style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={checked as boolean}
                  disabled={readOnly}
                  onChange={(e) =>
                    void togglePositive(field as "positiveGreatQuality", e.target.checked)
                  }
                />{" "}
                {label as string}
              </label>
            ))}
          </section>

          {weekSeniorTags.length > 0 && (
            <section>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Week assessment tags</div>
              {(() => {
                const grouped = groupTagsByValence(weekSeniorTags);
                const groups: Array<{ valence: TagValence; heading: string }> = [
                  { valence: "positive", heading: "Positive observations" },
                  { valence: "negative", heading: "Concerns" },
                ];
                return groups.map(({ valence, heading }) => {
                  const list = grouped.get(valence) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={valence} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {heading}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {list.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={"btn " + (selectedWeekTags.includes(t.id) ? "btn-primary" : "btn-ghost")}
                            disabled={weekTagsBusy || readOnly}
                            onClick={() => void toggleWeekTag(t.id)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </section>
          )}

          <section>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Issue summary</div>
            <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
              {(Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).map((cat) => (
                <li key={cat}>{TAG_CATEGORY_LABELS[cat]}: {rollup[cat]}</li>
              ))}
            </ul>
          </section>

          {isComplete && week.signoffAt && (
            <section style={{ fontSize: 13, color: "var(--ink-3)" }}>
              Approved {formatReviewedAt(week.signoffAt)}
              {week.signoffByName ? ` by ${week.signoffByName}` : ""}
            </section>
          )}

          {!readOnly && (
            <section style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setFinishConfirmOpen(true)}
                disabled={finishBusy}
              >
                {week?.signoffAt ? "Update your review note" : "Mark week as reviewed"}
              </button>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>
                Records that you&apos;ve reviewed this week&apos;s photos. Doesn&apos;t close
                the location — use <strong>Approve location</strong> on the location page
                when you&apos;re ready to close it for the season.
              </div>
            </section>
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              Photos ({filteredPhotos.length})
            </h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["all", "issues", "hidden"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={"btn " + (photoFilter === f ? "btn-primary" : "btn-ghost")}
                  onClick={() => { setPhotoFilter(f); setLightboxIndex(null); }}
                >
                  {f === "all" ? "All" : f === "issues" ? "Issues" : "Hidden"}
                </button>
              ))}
            </div>
          </div>

          {filteredPhotos.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No photos in this view.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {filteredPhotos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openPhoto(p.id)}
                  style={{
                    position: "relative",
                    aspectRatio: "4 / 3",
                    padding: 0,
                    borderRadius: 8,
                    overflow: "hidden",
                    border: photoBorder(p.triageState),
                    background: "var(--paper-3)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
                  {(p.triageState === "flagged" || p.triageState === "clean" || p.isQuarantined) && (
                    <div
                      aria-hidden
                      style={{
                        position: "absolute", inset: 0,
                        background: p.triageState === "deleted" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)",
                      }}
                    />
                  )}
                  {p.triageState === "flagged" && (
                    <div
                      aria-hidden
                      style={{
                        position: "absolute", top: 8, right: 8,
                        width: 28, height: 28, borderRadius: 999,
                        background: "var(--rose)", color: "white",
                        display: "grid", placeItems: "center",
                      }}
                    >
                      <Icon name="flag" size={16} />
                    </div>
                  )}
                  {p.triageState === "clean" && (
                    <div
                      aria-hidden
                      style={{
                        position: "absolute", top: 8, right: 8,
                        width: 28, height: 28, borderRadius: 999,
                        background: "var(--moss)", color: "white",
                        display: "grid", placeItems: "center",
                      }}
                    >
                      <Icon name="check" size={16} />
                    </div>
                  )}
                  <div
                    style={{
                      position: "absolute", left: 0, right: 0, bottom: 0,
                      padding: "8px 10px",
                      background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
                      color: "white",
                      fontSize: 11,
                      lineHeight: 1.35,
                    }}
                  >
                    {p.triageState === "flagged" && p.tagIds.length > 0 && (
                      <div style={{ marginBottom: 2 }}>
                        {p.tagIds.slice(0, 2).map((id) => labelLookup(id)).join(", ")}
                        {p.tagIds.length > 2 ? ` +${p.tagIds.length - 2}` : ""}
                      </div>
                    )}
                    {p.reviewerName && (
                      <div style={{ opacity: 0.9 }}>Reviewed by {p.reviewerName}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {lightboxPhoto && lightboxIndex !== null && (
        <SeniorPhotoLightbox
          photo={lightboxPhoto}
          labelLookup={labelLookup}
          position={`${lightboxIndex + 1} / ${filteredPhotos.length}`}
          readOnly={readOnly}
          busy={actionBusy}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < filteredPhotos.length - 1}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null || i <= 0 ? i : i - 1))}
          onNext={() => setLightboxIndex((i) => (i === null || i >= filteredPhotos.length - 1 ? i : i + 1))}
          onAction={(kind) => seniorAction(lightboxPhoto.id, kind)}
        />
      )}

      {finishConfirmOpen && week && (
        <FinishReviewModal
          weekName={week.name}
          locationName={week.locationName}
          onConfirm={() => void signoff()}
          onCancel={() => setFinishConfirmOpen(false)}
          busy={finishBusy}
        />
      )}
    </>
  );
}

function FinishReviewModal({
  weekName,
  locationName,
  onConfirm,
  onCancel,
  busy,
}: {
  weekName: string;
  locationName: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
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
        <h3 style={{ margin: 0 }}>Mark {weekName} as reviewed?</h3>
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>
          Records that you&apos;ve looked at this week&apos;s photos and recorded your feedback.
        </p>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: "var(--paper-3)",
            fontSize: 13,
            color: "var(--ink-2)",
            lineHeight: 1.5,
          }}
        >
          This is just a per-week marker — it doesn&apos;t affect the Camp Quality Review queue.
          When you&apos;re ready to close <strong>{locationName}</strong> for the rest of
          the season, use <strong>Approve location</strong> on the location page.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Recording…" : "Mark as reviewed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SeniorPhotoLightbox({
  photo,
  labelLookup,
  position,
  readOnly,
  busy,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
  onAction,
}: {
  photo: SeniorWeekPhoto;
  labelLookup: (id: string) => string;
  position: string;
  readOnly: boolean;
  busy: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAction: (kind: string) => void;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

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
        {position}
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
          {photo.reviewerName && (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              Reviewed by <strong>{photo.reviewerName}</strong>
              {photo.reviewedAt ? ` · ${formatReviewedAt(photo.reviewedAt)}` : ""}
            </div>
          )}

          {photo.tagIds.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {photo.tagIds.map((id) => {
                const label = labelLookup(id);
                if (!label) return null;
                return <span key={id} className="pill pill-rose">{label}</span>;
              })}
            </div>
          )}

          {photo.caption && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>{photo.caption}</div>
          )}

          {!readOnly && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {photo.triageState === "flagged" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void onAction("senior_unflag")}
                >
                  Unflag (approve)
                </button>
              )}
              {photo.triageState !== "deleted" && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onAction("senior_delete")}>
                  Delete
                </button>
              )}
              {!photo.isQuarantined && photo.triageState !== "deleted" && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onAction("senior_quarantine")}>
                  Hide from parent view
                </button>
              )}
              {photo.isQuarantined && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onAction("senior_release_quarantine")}>
                  Restore parent view
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** @deprecated Import SeniorWeekDashboard instead */
export const SeniorDashboard = SeniorWeekDashboard;
