"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, ToastApi } from "@/components/Shell";
import {
  FLAGGED_PHOTOS,
  FlaggedPhoto,
  PhotoPlaceholder,
  negativeTagLabel,
  photoPaletteFor,
} from "@/components/data";

type Resolution = "accepted" | "deleted";

export function FlagReviewScreen({ toast }: { toast: ToastApi }) {
  const [queue, setQueue] = React.useState<FlaggedPhoto[]>(FLAGGED_PHOTOS);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    FLAGGED_PHOTOS[0]?.id ?? null,
  );
  const [resolved, setResolved] = React.useState<
    Record<string, { photo: FlaggedPhoto; resolution: Resolution }>
  >({});

  const selected = queue.find(p => p.id === selectedId) ?? null;
  const resolvedCount = Object.keys(resolved).length;

  const resolve = (photo: FlaggedPhoto, resolution: Resolution) => {
    const remaining = queue.filter(p => p.id !== photo.id);
    setQueue(remaining);
    setResolved(prev => ({ ...prev, [photo.id]: { photo, resolution } }));
    if (selectedId === photo.id) {
      setSelectedId(remaining[0]?.id ?? null);
    }
    if (toast?.show) {
      toast.show(
        resolution === "accepted"
          ? `Accepted ${photo.id}`
          : `Deleted ${photo.id}`,
        resolution === "accepted" ? "check" : "x",
      );
    }
  };

  const download = (photo: FlaggedPhoto) => {
    downloadPhoto(photo);
    if (toast?.show) toast.show(`Downloading ${photo.id}.png`, "download");
  };

  return (
    <>
      <PageHeader
        eyebrow="Senior · Flag review"
        title="<em>Flagged</em> photos."
        sub="Review what staff reviewers couldn't decide. Accept it back into the library, delete it, or download it for a director conversation."
      >
        <span className="pill pill-sun" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {queue.length} open
        </span>
        {resolvedCount > 0 && (
          <span className="pill" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {resolvedCount} resolved this session
          </span>
        )}
      </PageHeader>

      <div
        className="page-body"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 380px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <FlagQueueList
          queue={queue}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {selected ? (
          <FlagDetailPanel
            photo={selected}
            onAccept={() => resolve(selected, "accepted")}
            onDelete={() => resolve(selected, "deleted")}
            onDownload={() => download(selected)}
          />
        ) : (
          <EmptyState resolvedCount={resolvedCount} />
        )}
      </div>
    </>
  );
}

function FlagQueueList({
  queue,
  selectedId,
  onSelect,
}: {
  queue: FlaggedPhoto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (queue.length === 0) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Queue</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          No flagged photos waiting.
        </div>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--rule)",
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}
      >
        <div className="card-eyebrow">Queue · oldest first</div>
        <span
          style={{
            fontSize: 11, color: "var(--ink-3)",
            fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
          }}
        >
          {queue.length} OPEN
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {queue.map(p => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderBottom: "1px solid var(--rule)",
                background: active ? "var(--paper-2)" : "transparent",
                borderLeft: active ? "3px solid var(--sun)" : "3px solid transparent",
                display: "flex", gap: 12,
                cursor: "pointer",
                transition: "background 0.12s",
              }}
            >
              <div
                style={{
                  width: 64, height: 48, flexShrink: 0,
                  borderRadius: 4, position: "relative", overflow: "hidden",
                }}
              >
                <PhotoPlaceholder
                  photo={{ id: p.id, camp: p.camp, activity: p.activity }}
                  hideLabel
                  compact
                />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline",
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12,
                    }}
                  >
                    {p.id}
                  </span>
                  <span
                    style={{
                      fontSize: 10, color: "var(--ink-3)",
                      fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.flaggedAtRelative}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12, color: "var(--ink-2)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {p.camp} · {p.flaggedBy}
                </div>
                <div
                  style={{
                    display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4,
                  }}
                >
                  {p.tags.slice(0, 2).map(t => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 999,
                        background: "var(--sun-soft)", color: "var(--sun)",
                        fontWeight: 500,
                      }}
                    >
                      {negativeTagLabel(t)}
                    </span>
                  ))}
                  {p.tags.length > 2 && (
                    <span
                      style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 999,
                        color: "var(--ink-3)", fontFamily: "var(--font-mono)",
                      }}
                    >
                      +{p.tags.length - 2}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FlagDetailPanel({
  photo,
  onAccept,
  onDelete,
  onDownload,
}: {
  photo: FlaggedPhoto;
  onAccept: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    setConfirmDelete(false);
  }, [photo.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          style={{
            position: "relative",
            aspectRatio: "3/2",
            background: "var(--paper-3)",
          }}
        >
          <PhotoPlaceholder
            photo={{ id: photo.id, camp: photo.camp, activity: photo.activity }}
          />
        </div>
        <div
          style={{
            padding: "14px 18px",
            display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between",
            borderTop: "1px solid var(--rule)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {photo.id}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {photo.camp} · {photo.activity} · {photo.capturedDate}, {photo.captured}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={onDownload}>
              <Icon name="download" size={13} /> Download
            </button>
            {confirmDelete ? (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-rose"
                  onClick={() => { setConfirmDelete(false); onDelete(); }}
                >
                  <Icon name="x" size={13} /> Confirm delete
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--rose)" }}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="x" size={13} /> Delete
                </button>
                <button className="btn btn-moss" onClick={onAccept}>
                  <Icon name="check" size={13} /> Accept
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div
          style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <h3 className="card-title">Flag details</h3>
          <span className="card-eyebrow">For senior reviewers</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "12px 24px",
            marginBottom: 16,
          }}
        >
          <DetailField label="Camp" value={photo.camp} />
          <DetailField label="Location" value={photo.campLocation} />
          <DetailField
            label="Camp week"
            value={`${photo.campWeek} · ${photo.campWeekDates}`}
          />
          <DetailField label="Activity" value={photo.activity} />
          <DetailField
            label="Captured"
            value={`${photo.capturedDate} · ${photo.captured}`}
          />
          <DetailField
            label="Flagged by"
            value={photo.flaggedBy}
            sub={photo.flaggedByEmail}
          />
          <DetailField label="Flagged at" value={photo.flaggedAt} />
          <DetailField
            label="Photo ID"
            value={photo.id}
            mono
          />
        </div>

        <div className="label" style={{ marginBottom: 6 }}>Negative tags</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {photo.tags.map(t => (
            <span
              key={t}
              style={{
                fontSize: 12, padding: "5px 10px", borderRadius: 999,
                background: "var(--sun-soft)", color: "var(--sun)",
                fontWeight: 500,
              }}
            >
              {negativeTagLabel(t)}
            </span>
          ))}
        </div>

        <div className="label" style={{ marginBottom: 6 }}>
          Reviewer note {!photo.note && (
            <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(none)</span>
          )}
        </div>
        {photo.note ? (
          <div
            style={{
              padding: 12,
              background: "var(--paper-2)",
              borderRadius: 8,
              border: "1px solid var(--rule)",
              fontSize: 13, color: "var(--ink-2)",
              lineHeight: 1.5,
              fontStyle: "italic",
            }}
          >
            “{photo.note}”
          </div>
        ) : (
          <div
            style={{
              padding: 12,
              border: "1px dashed var(--rule-2)",
              borderRadius: 8,
              fontSize: 12, color: "var(--ink-3)",
            }}
          >
            The reviewer didn&apos;t leave a note. Decide using the tags above and the photo itself.
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
          color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13, color: "var(--ink)", fontWeight: 500,
          fontFamily: mono ? "var(--font-mono)" : undefined,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11, color: "var(--ink-3)", marginTop: 1,
            fontFamily: "var(--font-mono)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function EmptyState({ resolvedCount }: { resolvedCount: number }) {
  return (
    <div
      className="card"
      style={{
        padding: 40,
        display: "grid", placeItems: "center",
        textAlign: "center",
        minHeight: 320,
      }}
    >
      <div>
        <div
          style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "var(--moss-soft)", color: "var(--moss)",
            display: "grid", placeItems: "center",
            margin: "0 auto 16px",
          }}
        >
          <Icon name="check" size={28} />
        </div>
        <h3 className="card-title" style={{ marginBottom: 6 }}>
          {resolvedCount > 0 ? "Queue cleared." : "Nothing flagged right now."}
        </h3>
        <p style={{ fontSize: 13, color: "var(--ink-3)", maxWidth: 320 }}>
          {resolvedCount > 0
            ? `You handled ${resolvedCount} ${resolvedCount === 1 ? "photo" : "photos"} this session. Nice work.`
            : "When staff reviewers send something up for a second opinion, it'll show up here."}
        </p>
      </div>
    </div>
  );
}

function downloadPhoto(photo: FlaggedPhoto) {
  if (typeof document === "undefined") return;
  const W = 1600;
  const H = 1067;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const [c1, c2] = photoPaletteFor(photo.id);
  const grad = ctx.createLinearGradient(0, 0, W * 0.4, H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const veil = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.3,
    W / 2, H / 2, Math.max(W, H) * 0.7,
  );
  veil.addColorStop(0, "rgba(0,0,0,0)");
  veil.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "500 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(photo.camp.toUpperCase(), 40, H - 36);
  const idText = photo.id;
  const idWidth = ctx.measureText(idText).width;
  ctx.fillText(idText, W - 40 - idWidth, H - 36);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "400 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`${photo.activity} · ${photo.capturedDate}`, 40, H - 64);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${photo.id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}
