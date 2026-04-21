"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { fireConfetti, ToastApi } from "@/components/Shell";
import {
  SESSION_PHOTOS,
  PHOTO_TAGS,
  REJECT_REASONS,
  FLAG_REASONS,
  EXAMPLES,
  PhotoPlaceholder,
} from "@/components/data";

type Decision = {
  decision: "approve" | "reject" | "flag";
  rating?: number;
  tags?: string[];
  note?: string;
  pts?: number;
};

type Photo = (typeof SESSION_PHOTOS)[number];

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
  const [index, setIndex] = React.useState(0);
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [modal, setModal] = React.useState<null | "approve" | "reject" | "flag">(null);
  const [pulse, setPulse] = React.useState<null | "approve" | "reject" | "flag">(null);

  const photo = SESSION_PHOTOS[index];
  const total = SESSION_PHOTOS.length;

  const labelFor = (kind: Decision["decision"]) =>
    kind === "approve" ? "Approved" :
    kind === "reject"  ? "Rejected" :
    "Flagged for admin";

  const commitDecision = (d: Decision) => {
    const pts = d.decision === "approve" ? 10 : d.decision === "reject" ? 10 : 15;
    const full: Decision = { ...d, pts };
    setDecisions(prev => ({ ...prev, [photo.id]: full }));
    setPulse(d.decision);
    if (toast && toast.showPoints) toast.showPoints(pts, labelFor(d.decision));
    setModal(null);
    setTimeout(() => {
      setPulse(null);
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
      if (e.key === "a" || e.key === "A") setModal("approve");
      else if (e.key === "r" || e.key === "R") setModal("reject");
      else if (e.key === "f" || e.key === "F") setModal("flag");
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, index, decisions]);

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
              {photo.camp}
            </span>
          </div>
          <div className="progress-track" style={{ height: 4 }}>
            <div className="progress-fill" style={{ width: progressPct + "%" }} />
          </div>
        </div>
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
                    : pulse === "reject"  ? "3px solid var(--rose)"
                    : pulse === "flag"    ? "3px solid var(--sun)"
                    : "none",
            }}>
              <PhotoPlaceholder photo={photo} />
            </div>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
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
              color="var(--rose)" tone="solid"
              onClick={() => setModal("reject")}
              icon="x" label="Reject" shortcut="R"
            />
            <BigAction
              color="var(--sun)" tone="outline"
              onClick={() => setModal("flag")}
              icon="flag" label="Flag" shortcut="F"
            />
          </div>

          <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
            {photo.activity} · {photo.captured}
          </div>
        </div>

        {showExamplesDrawer && (
          <aside style={{
            borderLeft: "1px solid var(--rule)",
            background: "var(--paper-2)",
            padding: 20,
            overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <div>
                <div className="card-eyebrow">Reference</div>
                <h3 className="card-title">What to look for</h3>
              </div>
              <button onClick={() => setShowExamplesDrawer(false)} style={{ color: "var(--ink-3)" }}>
                <Icon name="x" size={14} />
              </button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span className="pill pill-moss">
                  <Icon name="check" size={10} /> Approve
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {EXAMPLES.good.slice(0, 4).map((ex) => (
                  <div key={ex.id} style={{
                    aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                    position: "relative", border: "2px solid var(--moss)",
                  }}>
                    <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
                  </div>
                ))}
              </div>
              <ul style={{ marginTop: 10, paddingLeft: 16, fontSize: 12, color: "var(--ink-2)" }}>
                {EXAMPLES.good.map(ex => (
                  <li key={ex.id} style={{ marginBottom: 4 }}>
                    <strong>{ex.label}:</strong> {ex.note}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span className="pill pill-rose">
                  <Icon name="x" size={10} /> Reject
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {EXAMPLES.bad.slice(0, 4).map((ex) => (
                  <div key={ex.id} style={{
                    aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                    position: "relative", border: "2px solid var(--rose)",
                    filter: ex.id === "EX_B01" ? "blur(2px)" : "none",
                  }}>
                    <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
                  </div>
                ))}
              </div>
              <ul style={{ marginTop: 10, paddingLeft: 16, fontSize: 12, color: "var(--ink-2)" }}>
                {EXAMPLES.bad.map(ex => (
                  <li key={ex.id} style={{ marginBottom: 4 }}>
                    <strong>{ex.label}:</strong> {ex.note}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>

      {modal === "approve" && (
        <ApproveModal
          photo={photo}
          onCancel={() => setModal(null)}
          onConfirm={(rating, tags) => commitDecision({ decision: "approve", rating, tags })}
        />
      )}
      {modal === "reject" && (
        <RejectModal
          photo={photo}
          onCancel={() => setModal(null)}
          onConfirm={(reasons) => commitDecision({ decision: "reject", tags: reasons })}
        />
      )}
      {modal === "flag" && (
        <FlagModal
          photo={photo}
          onCancel={() => setModal(null)}
          onConfirm={(reasons, note) => commitDecision({ decision: "flag", tags: reasons, note })}
        />
      )}
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

const POSITIVE_TAGS = PHOTO_TAGS.filter(t => t.color !== "rose");

function ApproveModal({
  photo,
  onCancel,
  onConfirm,
}: {
  photo: Photo;
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
        {POSITIVE_TAGS.map(t => (
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
          <Icon name="check" size={13} /> Approve · +10 pts
        </button>
      </div>
    </Modal>
  );
}

function RejectModal({
  photo,
  onCancel,
  onConfirm,
}: {
  photo: Photo;
  onCancel: () => void;
  onConfirm: (reasons: string[]) => void;
}) {
  const [reasons, setReasons] = React.useState<string[]>([]);
  const toggle = (id: string) => setReasons(r => r.includes(id) ? r.filter(x => x !== id) : [...r, id]);

  return (
    <Modal onClose={onCancel}>
      <ModalHeader
        eyebrow="Rejecting"
        title="Why? Pick all that apply."
        tone="rose"
      />
      <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: -10, marginBottom: 18 }}>
        Your selections become tags on the photo. We use them to improve auto-filters.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {REJECT_REASONS.map(r => {
          const on = reasons.includes(r.id);
          return (
            <button
              key={r.id}
              onClick={() => toggle(r.id)}
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                border: on ? "1.5px solid var(--rose)" : "1px solid var(--rule)",
                background: on ? "var(--rose-soft)" : "var(--paper-2)",
                textAlign: "left",
                display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer",
                transition: "all 0.12s",
              }}
            >
              <div style={{
                width: 18, height: 18, flexShrink: 0,
                borderRadius: 4,
                border: on ? "none" : "1.5px solid var(--rule-2)",
                background: on ? "var(--rose)" : "transparent",
                display: "grid", placeItems: "center",
                color: "white",
              }}>
                {on && <Icon name="check" size={12} />}
              </div>
              <span style={{ fontSize: 14, fontWeight: on ? 500 : 400 }}>{r.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-rose"
          disabled={reasons.length === 0}
          style={{ opacity: reasons.length ? 1 : 0.5, cursor: reasons.length ? "pointer" : "not-allowed" }}
          onClick={() => onConfirm(reasons)}
        >
          <Icon name="x" size={13} /> Reject · +10 pts
        </button>
      </div>
    </Modal>
  );
}

function FlagModal({
  photo,
  onCancel,
  onConfirm,
}: {
  photo: Photo;
  onCancel: () => void;
  onConfirm: (reasons: string[], note: string) => void;
}) {
  const [reasons, setReasons] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const toggle = (id: string) => setReasons(r => r.includes(id) ? r.filter(x => x !== id) : [...r, id]);
  const canSubmit = reasons.length > 0 || note.trim().length > 0;

  return (
    <Modal onClose={onCancel} width={560}>
      <ModalHeader
        eyebrow="Flagging for admin"
        title="What should they look at?"
        tone="sun"
      />
      <p style={{ fontSize: 14, color: "var(--ink-2)", marginTop: -10, marginBottom: 18 }}>
        An admin will see this photo with your note and reasons in their queue.
      </p>

      <div className="label" style={{ marginBottom: 8 }}>Reason</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {FLAG_REASONS.map(r => (
          <button
            key={r.id}
            onClick={() => toggle(r.id)}
            className={"tag-chip" + (reasons.includes(r.id) ? " active" : "")}
            style={reasons.includes(r.id) ? {
              background: "var(--sun-soft)",
              borderColor: "var(--sun)",
              color: "var(--ink)",
            } : {}}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="label" style={{ marginBottom: 6 }}>Message to admin</div>
      <textarea
        className="textarea"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Could be a great shot but I'm not sure if the gesture is OK — want a second opinion."
        style={{ marginBottom: 20 }}
      />

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-sun"
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
          onClick={() => onConfirm(reasons, note.trim())}
        >
          <Icon name="flag" size={13} /> Flag & continue · +15 pts
        </button>
      </div>
    </Modal>
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
  const total = Object.values(decisions).reduce((s, d) => s + (d.pts || 0), 0);
  const counts = {
    approve: Object.values(decisions).filter(d => d.decision === "approve").length,
    reject:  Object.values(decisions).filter(d => d.decision === "reject").length,
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
          Batch complete
        </div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 120, fontWeight: 450,
          letterSpacing: "-0.04em", lineHeight: 0.9, color: "var(--ink)",
        }}>
          +{total}
        </div>
        <div style={{ fontSize: 18, color: "var(--ink-2)", marginBottom: 32 }}>
          points earned. Nice eye today.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 32 }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, color: "var(--moss)" }}>{counts.approve}</div>
            <div className="card-eyebrow">Approved</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, color: "var(--rose)" }}>{counts.reject}</div>
            <div className="card-eyebrow">Rejected</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, color: "var(--sun)" }}>{counts.flag}</div>
            <div className="card-eyebrow">Flagged</div>
          </div>
        </div>

        <div style={{
          padding: 16, borderRadius: "var(--radius)",
          background: "var(--sun-soft)",
          marginBottom: 24,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8, flexShrink: 0,
            background: "var(--sun)", color: "white",
            display: "grid", placeItems: "center",
          }}>
            <Icon name="fire" size={20} />
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 500 }}>
              Streak extended to day 10
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
              4 more days to earn &quot;Week Warrior+&quot;
            </div>
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
