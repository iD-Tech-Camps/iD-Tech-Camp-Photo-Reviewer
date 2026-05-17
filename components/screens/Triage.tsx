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
  const [index, setIndex] = React.useState(0);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [quarantineIntent, setQuarantineIntent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    const [p, c] = await Promise.all([
      fetchClaimPhotos(supabase, claimId),
      fetchWeekContext(supabase, campWeekId),
    ]);
    setPhotos(p);
    setCtx(c);
    setIndex((i) => Math.min(i, Math.max(0, p.length - 1)));
  }, [supabase, claimId, campWeekId]);

  React.useEffect(() => { void reload(); }, [reload]);

  const current = photos[index];
  const remaining = photos.filter((p) => p.triageState === "in_progress").length;

  const submit = async (kind: "clean" | "flag") => {
    if (!current || busy) return;
    if (kind === "flag" && selectedTags.length === 0) {
      toast.show("Pick at least one flag", "x");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/triage/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: current.id,
          claim_id: claimId,
          kind,
          tag_ids: selectedTags,
          quarantine_intent: kind === "flag" ? quarantineIntent : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submit failed");
      setSelectedTags([]);
      setQuarantineIntent(false);
      await reload();
      if (remaining <= 1) {
        await fetch(`/api/triage/claims/${claimId}/release`, { method: "POST" });
        toast.show("Claim complete", "check");
        onBack();
      }
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Submit failed", "x");
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    await fetch(`/api/triage/claims/${claimId}/release`, { method: "POST" });
    onBack();
  };

  if (!ctx) return <div className="page-body">Loading claim…</div>;

  return (
    <>
      <PageHeader
        eyebrow="Triage · Claim"
        title={`${ctx.locationName} — ${ctx.weekName}`}
        sub={`${remaining} photo(s) left in claim`}
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
          <button type="button" className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => void release()}>
            Release claim
          </button>
        </aside>

        <div>
          {current ? (
            <div className="card">
              <div style={{ position: "relative", width: "100%", height: 480, borderRadius: 8, overflow: "hidden" }}>
                <PhotoImg
                  src={current.imageUrl ?? current.thumbnailUrl}
                  alt={current.caption ?? "Photo"}
                  fit="contain"
                  loading="eager"
                />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit("clean")}>
                  Clean
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void submit("flag")}>
                  Flag
                </button>
              </div>
            </div>
          ) : (
            <div className="card">No photos left in this claim.</div>
          )}
        </div>
      </div>
    </>
  );
}

function SeniorDashboard({
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
