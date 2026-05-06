"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { BonusPennant, fireConfetti, ToastApi, useActiveBonusPeriod } from "@/components/Shell";
import { PhotoPlaceholder } from "@/components/data";
import { useSettings } from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import {
  fetchPendingPhotos,
  submitReview,
  type ReviewQueuePhoto,
} from "@/lib/reviews";
import { fetchTags, partitionActiveTags, type Tag } from "@/lib/tags";
import {
  basePointsFor,
  fetchPointsConfig,
  type PointsConfig,
} from "@/lib/points-config";

type Decision = {
  decision: "approve" | "flag";
  rating?: number;
  tags?: string[];
  note?: string;
  pts?: number;
  quarantine?: boolean;
};

type Photo = ReviewQueuePhoto;

// Captured timestamps come back as ISO strings; the prototype displayed a
// short clock-style "10:42 AM". Keep that look so the review header reads
// the same as it always did.
function formatCapturedTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ReviewScreen({
  onComplete,
  onExit,
  showExamplesDrawer,
  setShowExamplesDrawer,
  toast,
}: {
  onComplete: (decisions: Record<string, Decision>) => void;
  onExit: () => void;
  showExamplesDrawer: boolean;
  setShowExamplesDrawer: (v: boolean) => void;
  toast: ToastApi;
}) {
  const { id: reviewerId } = useCurrentUser();
  const { settings } = useSettings();
  const [photos, setPhotos] = React.useState<Photo[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [tags, setTags] = React.useState<Tag[] | null>(null);
  const [pointsConfig, setPointsConfig] = React.useState<PointsConfig | null>(null);
  const [index, setIndex] = React.useState(0);
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [modal, setModal] = React.useState<null | "approve" | "flag">(null);
  const [pulse, setPulse] = React.useState<null | "approve" | "flag">(null);
  const [submitting, setSubmitting] = React.useState(false);

  const activePeriod = useActiveBonusPeriod();
  const multiplier = activePeriod?.multiplier ?? 1;
  const approveBase = basePointsFor(pointsConfig, "approve");
  const flagBase    = basePointsFor(pointsConfig, "flag");

  // Pull the queue once on mount. Photos already reviewed in earlier sessions
  // are filtered server-side by `current_status = 'pending'`, so no client-side
  // dedupe is needed. Tags load in parallel — the modals open instantly with
  // an empty chip list and fill in once tags arrive (typically in the same
  // tick), instead of blocking the photo render on the tag round-trip.
  React.useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    fetchPendingPhotos(supabase, 10)
      .then((rows) => {
        if (!cancelled) setPhotos(rows);
      })
      .catch((err) => {
        console.error("[review-screen] fetch failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load photos");
          setPhotos([]);
        }
      });
    fetchTags(supabase)
      .then((rows) => {
        if (!cancelled) setTags(rows);
      })
      .catch((err) => {
        console.error("[review-screen] tags fetch failed:", err);
        if (!cancelled) setTags([]);
      });
    // points_config drives the base points shown on action buttons and
    // saved into reviews.points_awarded. Failure → log; basePointsFor()
    // falls back to DEFAULT_POINTS_CONFIG so reviewers can still submit.
    fetchPointsConfig(supabase)
      .then((cfg) => {
        if (!cancelled) setPointsConfig(cfg);
      })
      .catch((err) => {
        console.warn("[review-screen] points_config fetch failed:", err?.message ?? err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { positives: positiveTags, negatives: negativeTags } = React.useMemo(
    () => partitionActiveTags(tags ?? []),
    [tags],
  );

  const total = photos?.length ?? 0;
  const photo: Photo | undefined = photos ? photos[index] : undefined;

  const labelFor = (kind: Decision["decision"]) =>
    kind === "approve" ? "Approved" : "Flagged for admin";

  const commitDecision = async (d: Decision) => {
    if (!photo || submitting) return;
    if (!reviewerId) {
      console.error("[review-screen] no reviewer id; cannot submit");
      toast.show?.("Couldn't identify your account. Try refreshing.");
      return;
    }

    // Base points come from the live points_config (with DEFAULT fallback
    // if the fetch hasn't landed yet). The active multiplier bonus, if
    // any, inflates the base. The result is what reviewers see *and* what
    // the DB snapshots into reviews.points_awarded — no more drift between
    // the toast and the recorded value.
    const basePts = basePointsFor(pointsConfig, d.decision);
    const pts = Math.round(basePts * multiplier);

    setSubmitting(true);
    try {
      await submitReview(createClient(), {
        photoId:       photo.id,
        reviewerId,
        decision:      d.decision,
        rating:        d.rating,
        note:          d.note,
        tags:          d.tags,
        quarantine:    d.quarantine,
        pointsAwarded: pts,
      });
    } catch (err: any) {
      console.error("[review-screen] submit failed:", err);
      toast.show?.(err?.message ? `Couldn't save: ${err.message}` : "Couldn't save your review.");
      setSubmitting(false);
      return;
    }

    const full: Decision = { ...d, pts };
    setDecisions(prev => ({ ...prev, [photo.id]: full }));
    setPulse(d.decision);
    if (toast && toast.showPoints) toast.showPoints(pts, labelFor(d.decision));
    setModal(null);
    setTimeout(() => {
      setPulse(null);
      setSubmitting(false);
      if (index + 1 >= total) {
        fireConfetti(window.innerWidth / 2, window.innerHeight / 2, 120);
        setTimeout(() => onComplete({ ...decisions, [photo.id]: full }), 500);
      } else {
        setIndex(index + 1);
      }
    }, 280);
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal) {
        if (e.key === "Escape") setModal(null);
        return;
      }
      if (!photo || submitting) {
        if (e.key === "Escape") onExit();
        return;
      }
      if (e.key === "a" || e.key === "A") setModal("approve");
      else if (e.key === "f" || e.key === "F") setModal("flag");
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, index, decisions, photo, submitting]);

  if (photos === null) {
    return <ReviewLoading onExit={onExit} />;
  }
  if (photos.length === 0 || !photo) {
    return <ReviewEmpty onExit={onExit} error={loadError} />;
  }

  const progressPct = ((index + (decisions[photo.id] ? 1 : 0)) / total) * 100;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <div style={{
        padding: "12px 28px",
        borderBottom: "1px solid var(--rule)",
        display: "flex", alignItems: "center", gap: 20,
        background: "var(--paper-2)",
      }}>
        <button className="btn btn-ghost" onClick={onExit} style={{ padding: "6px 10px" }}>
          <Icon name="x" size={14} /> Exit
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 10, marginBottom: 5,
          }}>
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 500,
            }}>
              Photo {index + 1} <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>of {total}</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>·</span>
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
              {photo.campLabel}
            </span>
          </div>
          <div className="progress-track" style={{ height: 4 }}>
            <div className="progress-fill" style={{ width: progressPct + "%" }} />
          </div>
        </div>
        {activePeriod && <BonusPennant period={activePeriod} variant="compact" />}
        <button
          className={"btn " + (showExamplesDrawer ? "btn-primary" : "btn-ghost")}
          onClick={() => setShowExamplesDrawer(!showExamplesDrawer)}>
          <Icon name="book" size={13} /> Examples
        </button>
      </div>

      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: showExamplesDrawer ? "1fr 300px" : "1fr",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", flexDirection: "column",
          padding: "32px 40px 24px",
          overflow: "auto",
          minWidth: 0,
          alignItems: "center",
          gap: 28,
        }}>
          <div style={{
            position: "relative",
            maxWidth: "min(72vw, 1000px)",
            width: "100%",
            aspectRatio: "3/2",
          }}>
            <div className="hero-photo" style={{
              position: "absolute", inset: 0,
              transform: pulse ? "scale(0.985)" : "scale(1)",
              transition: "all 0.2s ease",
              border: pulse === "approve" ? "3px solid var(--moss)"
                    : pulse === "flag"    ? "3px solid var(--sun)"
                    : "none",
            }}>
              <PhotoPlaceholder photo={{
                id: photo.smugmugImageId,
                camp: photo.campLabel,
                activity: photo.caption ?? undefined,
              }} />
            </div>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            maxWidth: "min(72vw, 1000px)",
            width: "100%",
          }}>
            <BigAction
              color="var(--moss)" tone="solid"
              onClick={() => setModal("approve")}
              icon="check" label="Approve" shortcut="A"
            />
            <BigAction
              color="var(--sun)" tone="solid"
              onClick={() => setModal("flag")}
              icon="flag" label="Flag" shortcut="F"
            />
          </div>

          <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
            {[photo.caption, formatCapturedTime(photo.capturedAt)].filter(Boolean).join(" · ")}
          </div>
        </div>

        {showExamplesDrawer && (
          <aside style={{
            borderLeft: "1px solid var(--rule)",
            background: "var(--paper-2)",
            padding: 20,
            overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div>
                <div className="card-eyebrow">Quick guide</div>
                <h3 className="card-title">When to use each</h3>
              </div>
              <button onClick={() => setShowExamplesDrawer(false)} style={{ color: "var(--ink-3)" }}>
                <Icon name="x" size={14} />
              </button>
            </div>

            <GuideSection
              tone="moss"
              icon="check"
              label="Approve"
              intro="Share-worthy. A parent would be happy to see this."
              bullets={[
                "Campers are the clear subject and recognizable.",
                "Sharp focus, decent light, clean framing.",
                "Everyone looks safe, engaged, and appropriate.",
              ]}
            />

            <GuideSection
              tone="sun"
              icon="flag"
              label="Flag"
              intro="Anything that isn't a clear approve. Tag what you see and an admin will make the final call."
              bullets={[
                "Quality issues — blurry, dark, badly framed, duplicate.",
                "No campers visible, or backs of heads only.",
                "Possible safety, dress code, or behavior concern.",
                "Consent unclear, or you just want a second opinion.",
              ]}
              last
            />
          </aside>
        )}
      </div>

      {modal === "approve" && (
        <ApproveModal
          photo={photo}
          multiplier={multiplier}
          basePoints={approveBase}
          tags={positiveTags}
          onCancel={() => setModal(null)}
          onConfirm={(rating, tags) => commitDecision({ decision: "approve", rating, tags })}
        />
      )}
      {modal === "flag" && (
        <FlagModal
          photo={photo}
          multiplier={multiplier}
          basePoints={flagBase}
          tags={negativeTags}
          onCancel={() => setModal(null)}
          onConfirm={(tags, note, quarantine) =>
            commitDecision({ decision: "flag", tags, note, quarantine })
          }
        />
      )}
    </div>
  );
}


function ReviewLoading({ onExit }: { onExit: () => void }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "var(--paper)",
      padding: 40,
    }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div className="card-eyebrow" style={{ marginBottom: 8 }}>Loading queue</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, margin: "0 0 14px" }}>
          Pulling photos…
        </h2>
        <button className="btn btn-ghost" onClick={onExit}>
          <Icon name="x" size={13} /> Cancel
        </button>
      </div>
    </div>
  );
}

function ReviewEmpty({ onExit, error }: { onExit: () => void; error: string | null }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "var(--paper)",
      padding: 40,
    }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div className="pennant" style={{ marginBottom: 16, background: "var(--moss)" }}>
          {error ? "Couldn't load queue" : "Queue is empty"}
        </div>
        <p style={{ fontSize: 15, color: "var(--ink-2)", margin: "0 0 20px" }}>
          {error
            ? error
            : "No photos are waiting to be reviewed right now. Check back after the next SmugMug import."}
        </p>
        <button className="btn btn-primary" onClick={onExit}>
          Back to home
        </button>
      </div>
    </div>
  );
}

function GuideSection({
  tone,
  icon,
  label,
  intro,
  bullets,
  last,
}: {
  tone: "moss" | "rose" | "sun";
  icon: string;
  label: string;
  intro: string;
  bullets: string[];
  last?: boolean;
}) {
  const pillClass = tone === "moss" ? "pill pill-moss" : tone === "rose" ? "pill pill-rose" : "pill pill-sun";
  return (
    <div style={{ marginBottom: last ? 0 : 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span className={pillClass}>
          <Icon name={icon} size={10} /> {label}
        </span>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "0 0 8px" }}>
        {intro}
      </p>
      <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, color: "var(--ink-2)" }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function BigAction({
  color,
  tone,
  onClick,
  icon,
  label,
  shortcut,
}: {
  color: string;
  tone: "solid" | "outline";
  onClick: () => void;
  icon: string;
  label: string;
  shortcut: string;
}) {
  const solid = tone === "solid";
  return (
    <button
      onClick={onClick}
      style={{
        padding: "20px 16px",
        borderRadius: "var(--radius)",
        background: solid ? color : "var(--paper-2)",
        color: solid ? "white" : "var(--ink)",
        border: solid ? "none" : "1px solid var(--rule-2)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
        letterSpacing: "-0.01em",
        boxShadow: solid ? "var(--shadow-md)" : "none",
        transition: "transform 0.1s",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      <Icon name={icon} size={22} />
      {label}
      <span className="kbd" style={solid
        ? { background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "white", marginLeft: 4 }
        : { marginLeft: 4 }
      }>{shortcut}</span>
    </button>
  );
}

function Modal({
  children,
  onClose,
  width = 520,
}: {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20, 25, 30, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center",
        padding: 20,
        animation: "fade-in 0.15s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width,
          background: "var(--paper)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: 24,
          animation: "modal-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ eyebrow, title, tone }: { eyebrow: string; title: string; tone: "moss" | "rose" | "sun" }) {
  const toneColor = tone === "moss" ? "var(--moss)" : tone === "rose" ? "var(--rose)" : "var(--sun)";
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 11,
        letterSpacing: "0.12em", textTransform: "uppercase",
        color: toneColor, marginBottom: 4,
      }}>{eyebrow}</div>
      <h2 style={{
        fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500,
        letterSpacing: "-0.02em", margin: 0,
      }}>{title}</h2>
    </div>
  );
}

function ApproveModal({
  photo,
  multiplier,
  basePoints,
  tags: positiveTags,
  onCancel,
  onConfirm,
}: {
  photo: Photo;
  multiplier: number;
  basePoints: number;
  tags: Tag[];
  onCancel: () => void;
  onConfirm: (rating: number, tags: string[]) => void;
}) {
  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [tags, setTags] = React.useState<string[]>([]);

  const shown = hover || rating;
  const RATING_LABELS = ["", "Usable", "Good", "Great", "Excellent", "Hero shot"];

  return (
    <Modal onClose={onCancel}>
      <ModalHeader
        eyebrow="Approving"
        title="How good is it?"
        tone="moss"
      />
      <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: -10, marginBottom: 18 }}>
        Rating helps us surface the best photos for parents & marketing.
      </p>

      <div style={{
        display: "flex", justifyContent: "center", gap: 8,
        padding: "18px 0", marginBottom: 4,
      }}>
        {[1,2,3,4,5].map(n => (
          <button
            key={n}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            style={{
              padding: 4,
              transform: shown >= n ? "scale(1.05)" : "scale(1)",
              transition: "transform 0.1s",
            }}
          >
            <svg
              width="44" height="44" viewBox="0 0 24 24"
              fill={shown >= n ? "var(--sun)" : "none"}
              stroke={shown >= n ? "var(--sun)" : "var(--rule-2)"}
              strokeWidth="1.5" strokeLinejoin="round"
            >
              <path d="M12 2l2.8 6.3 6.7.7-5 4.7 1.4 6.6L12 17l-6 3.3 1.4-6.6-5-4.7 6.7-.7L12 2z"/>
            </svg>
          </button>
        ))}
      </div>
      <div style={{
        textAlign: "center",
        fontSize: 13, color: shown ? "var(--ink)" : "var(--ink-3)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
        textTransform: "uppercase", minHeight: 20, marginBottom: 18,
      }}>
        {shown ? RATING_LABELS[shown] : "Tap a star"}
      </div>

      <div className="label" style={{ marginBottom: 8 }}>Tags (optional)</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {positiveTags.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
            No approve tags configured.
          </span>
        ) : positiveTags.map(t => (
          <button
            key={t.id}
            className={"tag-chip" + (tags.includes(t.id) ? " active" : "")}
            onClick={() => setTags(tags.includes(t.id) ? tags.filter(x => x !== t.id) : [...tags, t.id])}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-moss"
          disabled={!rating}
          style={{ opacity: rating ? 1 : 0.5, cursor: rating ? "pointer" : "not-allowed" }}
          onClick={() => onConfirm(rating, tags)}
        >
          <Icon name="check" size={13} /> Approve · +{Math.round(basePoints * multiplier)} pts
        </button>
      </div>
    </Modal>
  );
}

function FlagModal({
  photo,
  multiplier,
  basePoints,
  tags: negativeTags,
  onCancel,
  onConfirm,
}: {
  photo: Photo;
  multiplier: number;
  basePoints: number;
  tags: Tag[];
  onCancel: () => void;
  onConfirm: (tags: string[], note: string, quarantine: boolean) => void;
}) {
  const [tags, setTags] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [quarantine, setQuarantine] = React.useState(false);
  const toggle = (id: string) => setTags(r => r.includes(id) ? r.filter(x => x !== id) : [...r, id]);
  const canSubmit = tags.length > 0;

  return (
    <Modal onClose={onCancel} width={560}>
      <ModalHeader
        eyebrow="Flagging for admin"
        title="What's wrong with it?"
        tone="sun"
      />
      <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: -10, marginBottom: 18 }}>
        Tag everything that applies. An admin will make the final call — your tags help them decide and improve our auto-filters.
      </p>

      <div className="label" style={{ marginBottom: 8 }}>Tags</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {negativeTags.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
            No flag tags configured. Ask an admin to add some in Admin → Points &amp; rules → Tag library.
          </span>
        ) : negativeTags.map(r => (
          <button
            key={r.id}
            onClick={() => toggle(r.id)}
            className={"tag-chip" + (tags.includes(r.id) ? " active" : "")}
            style={tags.includes(r.id) ? {
              background: "var(--sun-soft)",
              borderColor: "var(--sun)",
              color: "var(--ink)",
            } : {}}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Reason <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span></div>
      <textarea
        className="textarea"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add context for the admin — e.g. unsure if the gesture is OK, or want a second opinion on framing."
        style={{ marginBottom: 16 }}
      />

      <QuarantineCheckbox value={quarantine} onChange={setQuarantine} />

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-sun"
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
          onClick={() => onConfirm(tags, note.trim(), quarantine)}
        >
          <Icon name="flag" size={13} /> Flag & continue · +{Math.round(basePoints * multiplier)} pts
        </button>
      </div>
    </Modal>
  );
}

// "Quarantine" elevates a flag from a routine second-opinion request to a
// hide-now action — the photo stops being publicly visible until a senior
// resolves it. Schema-wise this just sets `reviews.quarantine = true`; a
// trigger flips `photos.is_quarantined` and the SmugMug import job (step 8)
// will mirror that into the hidden folder.
function QuarantineCheckbox({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: 8,
        border: value ? "1.5px solid var(--rose)" : "1px solid var(--rule)",
        background: value ? "var(--rose-soft)" : "var(--paper-2)",
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--rose)", flexShrink: 0 }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: value ? "var(--rose)" : "var(--ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="flag" size={12} /> Quarantine — hide from public until a senior reviews
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.4 }}>
          Use only for clear safety, dress code, or consent issues. Routine quality flags don&apos;t need this — they stay visible while the senior queue catches up.
        </div>
      </div>
    </label>
  );
}

export function SessionComplete({
  decisions,
  onHome,
  onAnother,
}: {
  decisions: Record<string, Decision>;
  onHome: () => void;
  onAnother: () => void;
}) {
  const { settings } = useSettings();
  const total = Object.values(decisions).reduce((s, d) => s + (d.pts || 0), 0);
  const counts = {
    approve: Object.values(decisions).filter(d => d.decision === "approve").length,
    flag:    Object.values(decisions).filter(d => d.decision === "flag").length,
  };
  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "var(--paper)",
      padding: 40,
    }}>
      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <div className="pennant" style={{ marginBottom: 20, background: "var(--moss)" }}>
          {settings.completionTitle}
        </div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 120, fontWeight: 450,
          letterSpacing: "-0.04em", lineHeight: 0.9, color: "var(--ink)",
        }}>
          +{total}
        </div>
        <div style={{ fontSize: 18, color: "var(--ink-2)", marginBottom: 32 }}>
          {settings.completionMessage}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 32 }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, color: "var(--moss)" }}>{counts.approve}</div>
            <div className="card-eyebrow">Approved</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, color: "var(--sun)" }}>{counts.flag}</div>
            <div className="card-eyebrow">Flagged</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="btn btn-ghost btn-lg" onClick={onHome}>
            Back to Review
          </button>
          <button className="btn btn-primary btn-lg" onClick={onAnother}>
            <Icon name="play" size={14} /> Another batch
          </button>
        </div>
      </div>
    </div>
  );
}
