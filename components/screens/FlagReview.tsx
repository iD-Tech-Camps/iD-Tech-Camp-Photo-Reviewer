"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, ToastApi } from "@/components/Shell";
import { PhotoImg } from "@/components/PhotoImg";
import { useCurrentUser } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import {
  fetchFlaggedPhotos,
  submitReview,
  type FlaggedQueueItem,
} from "@/lib/reviews";
import { buildTagLabelLookup, fetchTags } from "@/lib/tags";

type Resolution = "accepted" | "deleted";

export function FlagReviewScreen({ toast }: { toast: ToastApi }) {
  const { id: reviewerId } = useCurrentUser();
  const [queue, setQueue] = React.useState<FlaggedQueueItem[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tagLabel, setTagLabel] = React.useState<(id: string) => string>(
    () => (id: string) => id,
  );
  const [resolved, setResolved] = React.useState<
    Record<string, { photo: FlaggedQueueItem; resolution: Resolution }>
  >({});
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    fetchFlaggedPhotos(supabase)
      .then((rows) => {
        if (cancelled) return;
        setQueue(rows);
        setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
      })
      .catch((err) => {
        console.error("[flag-review] fetch failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load flagged photos");
          setQueue([]);
        }
      });
    // Load tag labels in parallel. Until they arrive, the chips render the
    // raw tag id as their label — readable, just less polished than the
    // friendly text. Includes inactive tags so historical flags still get
    // a label even if an admin has since hidden the tag.
    fetchTags(supabase)
      .then((tags) => {
        if (cancelled) return;
        const lookup = buildTagLabelLookup(tags);
        setTagLabel(() => lookup);
      })
      .catch((err) => {
        console.warn("[flag-review] tags fetch failed:", err?.message ?? err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = queue ?? [];
  const selected = items.find((p) => p.id === selectedId) ?? null;
  const resolvedCount = Object.keys(resolved).length;

  const resolve = async (photo: FlaggedQueueItem, resolution: Resolution) => {
    if (submitting) return;
    if (!reviewerId) {
      toast.show?.("Couldn't identify your account. Try refreshing.");
      return;
    }
    setSubmitting(true);
    try {
      // Senior accept = approve review (with no rating). Senior delete =
      // delete review. Both go through the same triggers and RLS path.
      await submitReview(createClient(), {
        photoId: photo.id,
        reviewerId,
        decision: resolution === "accepted" ? "approve" : "delete",
      });
    } catch (err: any) {
      console.error("[flag-review] submit failed:", err);
      toast.show?.(err?.message ? `Couldn't save: ${err.message}` : "Couldn't save your decision.");
      setSubmitting(false);
      return;
    }

    setQueue((prev) => {
      if (!prev) return prev;
      const remaining = prev.filter((p) => p.id !== photo.id);
      if (selectedId === photo.id) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
    setResolved((prev) => ({ ...prev, [photo.id]: { photo, resolution } }));
    setSubmitting(false);

    if (toast?.show) {
      toast.show(
        resolution === "accepted"
          ? `Accepted ${photo.smugmugImageId}`
          : `Deleted ${photo.smugmugImageId}`,
        resolution === "accepted" ? "check" : "x",
      );
    }
  };

  const download = async (photo: FlaggedQueueItem) => {
    const ok = await downloadPhoto(photo);
    if (!toast?.show) return;
    if (ok) {
      toast.show(`Downloading ${photo.smugmugImageId}.jpg`, "download");
    } else {
      toast.show("Couldn't fetch the photo from SmugMug.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Senior · Flag review"
        title="<em>Flagged</em> photos."
        sub="Review what staff reviewers couldn't decide. Accept it back into the library, delete it, or download it for a director conversation."
      >
        <span className="pill pill-sun" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {queue === null ? "…" : `${items.length} open`}
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
          queue={items}
          loading={queue === null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          tagLabel={tagLabel}
        />
        {selected ? (
          <FlagDetailPanel
            photo={selected}
            disabled={submitting}
            tagLabel={tagLabel}
            onAccept={() => resolve(selected, "accepted")}
            onDelete={() => resolve(selected, "deleted")}
            onDownload={() => download(selected)}
          />
        ) : (
          <EmptyState resolvedCount={resolvedCount} loading={queue === null} error={loadError} />
        )}
      </div>
    </>
  );
}

function FlagQueueList({
  queue,
  loading,
  selectedId,
  onSelect,
  tagLabel,
}: {
  queue: FlaggedQueueItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tagLabel: (id: string) => string;
}) {
  if (loading) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="card-eyebrow" style={{ marginBottom: 6 }}>Queue</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>
      </div>
    );
  }
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
        {queue.map((p) => {
          const active = p.id === selectedId;
          const reviewerLabel = p.flagReview.reviewerName
            ?? p.flagReview.reviewerEmail
            ?? "Unknown reviewer";
          const campLabel = [p.divisionName, p.locationName].filter(Boolean).join(" · ");
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
                <PhotoImg
                  src={p.thumbnailUrl ?? p.imageUrl}
                  alt={p.caption ?? p.smugmugImageId}
                  loading="lazy"
                  fit="cover"
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
                      display: "flex", alignItems: "center", gap: 6,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {p.smugmugImageId}
                    </span>
                    {p.flagReview.quarantine && (
                      <span
                        title="Quarantined — hidden from public folder"
                        style={{
                          fontSize: 9, padding: "2px 6px", borderRadius: 999,
                          background: "var(--rose-soft)", color: "var(--rose)",
                          fontWeight: 600, fontFamily: "var(--font-mono)",
                          letterSpacing: "0.08em", textTransform: "uppercase",
                          flexShrink: 0,
                        }}
                      >
                        Quarantined
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: 10, color: "var(--ink-3)",
                      fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatRelative(p.flagReview.createdAt)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12, color: "var(--ink-2)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {campLabel} · {reviewerLabel}
                </div>
                <div
                  style={{
                    display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4,
                  }}
                >
                  {p.flagReview.tagIds.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 999,
                        background: "var(--sun-soft)", color: "var(--sun)",
                        fontWeight: 500,
                      }}
                    >
                      {tagLabel(t)}
                    </span>
                  ))}
                  {p.flagReview.tagIds.length > 2 && (
                    <span
                      style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 999,
                        color: "var(--ink-3)", fontFamily: "var(--font-mono)",
                      }}
                    >
                      +{p.flagReview.tagIds.length - 2}
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
  disabled,
  tagLabel,
  onAccept,
  onDelete,
  onDownload,
}: {
  photo: FlaggedQueueItem;
  disabled: boolean;
  tagLabel: (id: string) => string;
  onAccept: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    setConfirmDelete(false);
  }, [photo.id]);

  const campLabel = [photo.divisionName, photo.locationName].filter(Boolean).join(" · ");
  const capturedDate = formatDate(photo.capturedAt);
  const capturedTime = formatTime(photo.capturedAt);
  const flaggedAt = `${formatDate(photo.flagReview.createdAt)} · ${formatTime(photo.flagReview.createdAt)}`;
  const reviewerLabel = photo.flagReview.reviewerName ?? photo.flagReview.reviewerEmail ?? "Unknown reviewer";
  const campWeekDates = formatDateRange(photo.campWeekStarts, photo.campWeekEnds);

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
          <PhotoImg
            src={photo.imageUrl ?? photo.thumbnailUrl}
            alt={photo.caption ?? `Flagged photo ${photo.smugmugImageId}`}
            loading="eager"
            fit="contain"
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
              {photo.smugmugImageId}
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {[campLabel, photo.caption, capturedDate && capturedTime ? `${capturedDate}, ${capturedTime}` : capturedDate || capturedTime]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={onDownload} disabled={disabled}>
              <Icon name="download" size={13} /> Download
            </button>
            {confirmDelete ? (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => setConfirmDelete(false)}
                  disabled={disabled}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-rose"
                  onClick={() => { setConfirmDelete(false); onDelete(); }}
                  disabled={disabled}
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
                  disabled={disabled}
                >
                  <Icon name="x" size={13} /> Delete
                </button>
                <button className="btn btn-moss" onClick={onAccept} disabled={disabled}>
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
          <DetailField label="Division" value={photo.divisionName ?? "—"} />
          <DetailField label="Location" value={photo.locationName ?? "—"} />
          <DetailField
            label="Camp week"
            value={
              photo.campWeekName
                ? campWeekDates
                  ? `${photo.campWeekName} · ${campWeekDates}`
                  : photo.campWeekName
                : "—"
            }
          />
          <DetailField label="Caption" value={photo.caption ?? "—"} />
          <DetailField
            label="Captured"
            value={[capturedDate, capturedTime].filter(Boolean).join(" · ") || "—"}
          />
          <DetailField
            label="Flagged by"
            value={reviewerLabel}
            sub={photo.flagReview.reviewerName ? photo.flagReview.reviewerEmail ?? undefined : undefined}
          />
          <DetailField label="Flagged at" value={flaggedAt} />
          <DetailField
            label="SmugMug ID"
            value={photo.smugmugImageId}
            mono
          />
        </div>

        {photo.flagReview.quarantine && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: "var(--rose-soft)",
              color: "var(--rose)",
              fontSize: 12,
              fontWeight: 500,
              marginBottom: 16,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="flag" size={12} /> Quarantined — hidden from public folder until resolved.
          </div>
        )}

        <div className="label" style={{ marginBottom: 6 }}>Negative tags</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {photo.flagReview.tagIds.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No tags applied.</span>
          ) : (
            photo.flagReview.tagIds.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 12, padding: "5px 10px", borderRadius: 999,
                  background: "var(--sun-soft)", color: "var(--sun)",
                  fontWeight: 500,
                }}
              >
                {tagLabel(t)}
              </span>
            ))
          )}
        </div>

        <div className="label" style={{ marginBottom: 6 }}>
          Reviewer note {!photo.flagReview.note && (
            <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(none)</span>
          )}
        </div>
        {photo.flagReview.note ? (
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
            “{photo.flagReview.note}”
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

function EmptyState({
  resolvedCount,
  loading,
  error,
}: {
  resolvedCount: number;
  loading: boolean;
  error: string | null;
}) {
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
            background: error ? "var(--sun-soft)" : "var(--moss-soft)",
            color: error ? "var(--sun)" : "var(--moss)",
            display: "grid", placeItems: "center",
            margin: "0 auto 16px",
          }}
        >
          <Icon name={error ? "flag" : "check"} size={28} />
        </div>
        <h3 className="card-title" style={{ marginBottom: 6 }}>
          {error
            ? "Couldn't load queue."
            : loading
              ? "Loading flagged photos…"
              : resolvedCount > 0
                ? "Queue cleared."
                : "Nothing flagged right now."}
        </h3>
        <p style={{ fontSize: 13, color: "var(--ink-3)", maxWidth: 320 }}>
          {error
            ? error
            : loading
              ? "Pulling the senior queue from the database."
              : resolvedCount > 0
                ? `You handled ${resolvedCount} ${resolvedCount === 1 ? "photo" : "photos"} this session. Nice work.`
                : "When staff reviewers send something up for a second opinion, it'll show up here."}
        </p>
      </div>
    </div>
  );
}

// ── time helpers ────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatDateRange(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "";
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString([], { month: "short", day: "numeric" });
  const right = b.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60)        return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)        return `${min}m ago`;
  const hr  = Math.round(min / 60);
  if (hr  < 24)        return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7)         return `${day}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── download helper ──────────────────────────────────────────────────────
// Fetches the real SmugMug image and triggers a browser download.
// Returns false if no usable URL is available or the fetch fails — the
// caller surfaces an error toast in that case rather than silently no-op'ing.
//
// We fetch + blob-ify rather than just setting `<a download>` directly on
// the SmugMug URL because cross-origin downloads ignore the `download`
// attribute (the browser navigates instead). Going through a blob URL
// forces the actual download path. SmugMug allows direct fetch from the
// browser as long as the URL is the public ArchivedUri; no auth needed.
async function downloadPhoto(photo: FlaggedQueueItem): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const url = photo.imageUrl ?? photo.thumbnailUrl;
  if (!url) return false;

  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return false;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    // Pick a friendly filename: smugmug image id + an extension inferred
    // from the blob mime type (defaults to .jpg, which matches what
    // SmugMug serves for ArchivedUri the vast majority of the time).
    const ext = blob.type === "image/png" ? "png" : "jpg";
    a.download = `${photo.smugmugImageId}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return true;
  } catch (err) {
    console.error("[flag-review] download failed:", err);
    return false;
  }
}
