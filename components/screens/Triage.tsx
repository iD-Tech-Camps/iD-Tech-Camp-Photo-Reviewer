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
  fetchCategoryRollup,
  fetchFlaggedPhotosForWeek,
  fetchSeniorWeek,
  type SeniorFlaggedPhoto,
  type SeniorWeekSummary,
} from "@/lib/triage-senior";
import { signoffCampWeek, setPositiveAssessment } from "@/lib/triage-signoff";
import {
  buildTagLabelLookup,
  fetchTags,
  TAG_CATEGORY_LABELS,
  type Tag,
  type TagCategory,
} from "@/lib/tags";

type View =
  | { kind: "hub" }
  | { kind: "claim"; claimId: string; campWeekId: string }
  | { kind: "senior"; campWeekId: string };

export function TriageApp({ toast }: { toast: ToastApi }) {
  const user = useCurrentUser();
  const userId = user.id;
  const role = user.role;
  const supabase = React.useMemo(() => createClient(), []);
  const [view, setView] = React.useState<View>({ kind: "hub" });
  const [weeks, setWeeks] = React.useState<TriageHubWeek[] | null>(null);
  const [claims, setClaims] = React.useState<ActiveClaim[]>([]);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const reloadHub = React.useCallback(async () => {
    if (!userId) return;
    const [w, c, t] = await Promise.all([
      fetchTriageHubWeeks(supabase),
      fetchActiveClaimsForReviewer(supabase, userId),
      fetchTags(supabase),
    ]);
    setWeeks(w);
    setClaims(c);
    setTags(t.filter((x) => x.active));
  }, [supabase, userId]);

  React.useEffect(() => {
    let cancelled = false;
    reloadHub()
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message ?? "Failed to load triage hub");
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
      if (!res.ok) throw new Error(json.error ?? "Claim failed");
      setView({ kind: "claim", claimId: json.claim.id, campWeekId });
      await reloadHub();
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Claim failed", "x");
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
      />
    );
  }

  if (view.kind === "senior") {
    return (
      <SeniorDashboard
        toast={toast}
        supabase={supabase}
        campWeekId={view.campWeekId}
        tags={tags}
        onBack={() => { setView({ kind: "hub" }); void reloadHub(); }}
      />
    );
  }

  const labelLookup = buildTagLabelLookup(tags);

  return (
    <>
      <PageHeader
        eyebrow="Triage"
        title="Camp weeks <em>needing triage</em>"
        sub={claims.length > 0 ? `${claims.length} active claim(s)` : "Pick a week to claim a slice"}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {loadError && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{loadError}</div>}

        {claims.length > 0 && (
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 8 }}>Your active claims</h3>
            {claims.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn-ghost"
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}
                onClick={() => setView({ kind: "claim", claimId: c.id, campWeekId: c.campWeekId })}
              >
                Resume claim · {c.sliceSize} photos
              </button>
            ))}
          </div>
        )}

        {(weeks ?? []).map((w) => (
          <div key={w.id} className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{w.locationName} — {w.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {w.triageRole} · {w.triageState} · {w.pendingCount} pending
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openClaim(w.id, Math.max(1, w.pendingCount))}
                disabled={w.pendingCount === 0}
              >
                Claim slice ({w.pendingCount || 0})
              </button>
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
              {(role === "senior" || role === "admin") &&
                ["triage_done", "senior_review"].includes(w.triageState) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setView({ kind: "senior", campWeekId: w.id })}
                >
                  Senior review
                </button>
              )}
            </div>
          </div>
        ))}

        {weeks !== null && weeks.length === 0 && (
          <div className="card" style={{ color: "var(--ink-3)" }}>No camp weeks need triage right now.</div>
        )}
      </div>
    </>
  );
}

type ReviewKind = "clean" | "flag";

function ClaimGrid({
  toast,
  supabase,
  claimId,
  campWeekId,
  tags,
  onBack,
}: {
  toast: ToastApi;
  supabase: ReturnType<typeof createClient>;
  claimId: string;
  campWeekId: string;
  tags: Tag[];
  onBack: () => void;
}) {
  const [photos, setPhotos] = React.useState<ClaimPhoto[]>([]);
  const [ctx, setCtx] = React.useState<{ weekName: string; locationName: string; evergreenNotes: string | null } | null>(null);
  // Local-only review map. The DB trigger nulls triage_claim_id once an
  // event lands, so a re-fetch would drop the photo from the grid mid-
  // session; tracking decisions here keeps the grid stable until release.
  const [reviewed, setReviewed] = React.useState<Record<string, ReviewKind>>({});
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

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

  const total = photos.length;
  const reviewedCount = photos.reduce((n, p) => n + (reviewed[p.id] ? 1 : 0), 0);
  const allDone = total > 0 && reviewedCount === total;

  const findNextUnreviewed = (from: number, map: Record<string, ReviewKind>): number | null => {
    for (let i = from + 1; i < photos.length; i++) if (!map[photos[i].id]) return i;
    for (let i = 0; i < from; i++) if (!map[photos[i].id]) return i;
    return null;
  };

  const submit = async (
    photoId: string,
    kind: ReviewKind,
    tagIds: string[],
    quarantineIntent: boolean,
  ): Promise<boolean> => {
    if (kind === "flag" && tagIds.length === 0) {
      toast.show("Pick at least one flag", "x");
      return false;
    }
    try {
      const res = await fetch("/api/triage/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: photoId,
          claim_id: claimId,
          kind,
          tag_ids: tagIds,
          quarantine_intent: kind === "flag" ? quarantineIntent : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submit failed");
      setReviewed((m) => ({ ...m, [photoId]: kind }));
      return true;
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Submit failed", "x");
      return false;
    }
  };

  const release = async () => {
    await fetch(`/api/triage/claims/${claimId}/release`, { method: "POST" });
    onBack();
  };

  const finish = async () => {
    await fetch(`/api/triage/claims/${claimId}/release`, { method: "POST" });
    toast.show("Claim complete", "check");
    onBack();
  };

  if (!ctx) return <div className="page-body">Loading claim…</div>;

  const lightboxPhoto = lightboxIndex !== null ? photos[lightboxIndex] ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="Triage · Claim"
        title={`${ctx.locationName} — ${ctx.weekName}`}
        sub={`${reviewedCount} of ${total} reviewed`}
      />
      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20 }}>
        <aside className="card" style={{ fontSize: 13 }}>
          <button type="button" className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 12 }}>← Hub</button>
          {ctx.evergreenNotes && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Evergreen notes</div>
              <p style={{ color: "var(--ink-2)", lineHeight: 1.5 }}>{ctx.evergreenNotes}</p>
            </>
          )}
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className={"btn " + (allDone ? "btn-moss" : "btn-ghost")}
              disabled={!allDone}
              onClick={() => void finish()}
            >
              Finish & release
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void release()}>
              Release claim
            </button>
          </div>
        </aside>

        <div>
          {photos.length === 0 ? (
            <div className="card">No photos in this claim.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {photos.map((p, idx) => {
                const decision = reviewed[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setLightboxIndex(idx)}
                    aria-label={`Photo ${idx + 1} of ${total}${decision ? `, marked ${decision}` : ""}`}
                    style={{
                      position: "relative",
                      aspectRatio: "4 / 3",
                      padding: 0,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: decision === "clean"
                        ? "2px solid var(--moss)"
                        : decision === "flag"
                        ? "2px solid var(--rose)"
                        : "1px solid var(--rule)",
                      background: "var(--paper-3)",
                      cursor: "pointer",
                    }}
                  >
                    <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
                    {decision && (
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
                            background: decision === "clean" ? "var(--moss)" : "var(--rose)",
                            color: "white",
                            display: "grid", placeItems: "center",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                          }}
                        >
                          <Icon name={decision === "clean" ? "check" : "flag"} size={16} />
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

      {lightboxPhoto && lightboxIndex !== null && (
        <Lightbox
          photo={lightboxPhoto}
          tags={tags}
          position={`${lightboxIndex + 1} / ${total}`}
          existingDecision={reviewed[lightboxPhoto.id]}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < total - 1}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null || i <= 0 ? i : i - 1))}
          onNext={() => setLightboxIndex((i) => (i === null || i >= total - 1 ? i : i + 1))}
          onSubmit={async (kind, tagIds, quarantineIntent) => {
            const ok = await submit(lightboxPhoto.id, kind, tagIds, quarantineIntent);
            if (!ok) return;
            const nextMap = { ...reviewed, [lightboxPhoto.id]: kind };
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
  existingDecision,
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
  existingDecision: ReviewKind | undefined;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: (kind: ReviewKind, tagIds: string[], quarantineIntent: boolean) => Promise<void>;
}) {
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [quarantineIntent, setQuarantineIntent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setSelectedTags([]);
    setQuarantineIntent(false);
  }, [photo.id]);

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

  const handle = async (kind: ReviewKind) => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(kind, selectedTags, quarantineIntent);
    } finally {
      setBusy(false);
    }
  };

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
        {position}{existingDecision ? ` · ${existingDecision}` : ""}
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
            src={photo.imageUrl ?? photo.thumbnailUrl}
            alt={photo.caption ?? "Photo"}
            fit="contain"
            loading="eager"
            background="transparent"
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={quarantineIntent}
              onChange={(e) => setQuarantineIntent(e.target.checked)}
            />
            Quarantine intent (flag)
          </label>
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn btn-moss"
              disabled={busy}
              onClick={() => void handle("clean")}
            >
              <Icon name="check" size={14} />
              Clean
            </button>
            <button
              type="button"
              className="btn btn-rose"
              disabled={busy}
              onClick={() => void handle("flag")}
            >
              <Icon name="flag" size={14} />
              Flag
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SeniorDashboard({
  toast,
  supabase,
  campWeekId,
  tags,
  onBack,
}: {
  toast: ToastApi;
  supabase: ReturnType<typeof createClient>;
  campWeekId: string;
  tags: Tag[];
  onBack: () => void;
}) {
  const [week, setWeek] = React.useState<SeniorWeekSummary | null>(null);
  const [flagged, setFlagged] = React.useState<SeniorFlaggedPhoto[]>([]);
  const [rollup, setRollup] = React.useState<Record<TagCategory, number> | null>(null);
  const [recheck, setRecheck] = React.useState(false);
  const labelLookup = buildTagLabelLookup(tags);

  const reload = React.useCallback(async () => {
    const [w, f, r] = await Promise.all([
      fetchSeniorWeek(supabase, campWeekId),
      fetchFlaggedPhotosForWeek(supabase, campWeekId),
      fetchCategoryRollup(supabase, campWeekId),
    ]);
    setWeek(w);
    setFlagged(f);
    setRollup(r);
    setRecheck(false);
  }, [supabase, campWeekId]);

  React.useEffect(() => { void reload(); }, [reload]);

  const togglePositive = async (
    field: "positiveGreatQuality" | "positiveGreatVariety" | "positiveShininessGreat",
    value: boolean,
  ) => {
    if (!week) return;
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
    const res = await fetch("/api/triage/events/senior", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_id: photoId, kind }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Action failed");
    await reload();
  };

  const signoff = async () => {
    try {
      await signoffCampWeek(supabase, campWeekId, recheck && week?.triageRole === "first_week");
      toast.show("Week signed off", "check");
      onBack();
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Signoff failed", "x");
    }
  };

  if (!week || !rollup) return <div className="page-body">Loading senior dashboard…</div>;

  return (
    <>
      <PageHeader
        eyebrow="Senior · Camp week"
        title={`${week.locationName} — ${week.name}`}
        sub={week.triageState}
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>← Hub</button>

        <div className="card">
          <h3 className="card-title">Positive assessments</h3>
          {[
            ["Great Quality", "positiveGreatQuality", week.positiveGreatQuality],
            ["Great Variety", "positiveGreatVariety", week.positiveGreatVariety],
            ["Shininess Looks Great", "positiveShininessGreat", week.positiveShininessGreat],
          ].map(([label, field, checked]) => (
            <label key={field as string} style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={checked as boolean}
                onChange={(e) =>
                  void togglePositive(field as "positiveGreatQuality", e.target.checked)
                }
              />{" "}
              {label as string}
            </label>
          ))}
        </div>

        <div className="card">
          <h3 className="card-title">Rollup by category</h3>
          <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
            {(Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]).map((cat) => (
              <li key={cat}>{TAG_CATEGORY_LABELS[cat]}: {rollup[cat]}</li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3 className="card-title">Flagged photos ({flagged.length})</h3>
          {flagged.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-start" }}>
              <div style={{ position: "relative", width: 120, height: 80, flexShrink: 0, borderRadius: 6, overflow: "hidden" }}>
                <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  {(p.tagIds.map((id) => labelLookup(id))).join(", ") || "—"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-ghost" onClick={() => void seniorAction(p.id, "senior_delete")}>Delete</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void seniorAction(p.id, "senior_quarantine")}>Quarantine</button>
                  {p.isQuarantined && (
                    <button type="button" className="btn btn-ghost" onClick={() => void seniorAction(p.id, "senior_release_quarantine")}>Release quarantine</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          {week.triageRole === "first_week" && (
            <label style={{ display: "block", marginBottom: 12, fontSize: 13 }}>
              <input type="checkbox" checked={recheck} onChange={(e) => setRecheck(e.target.checked)} />
              {" "}Flag 2nd week for recheck on signoff
            </label>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void signoff()}>
            Sign off week
          </button>
        </div>
      </div>
    </>
  );
}
