"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PhotoImg } from "@/components/PhotoImg";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";
import { buildTagLabelLookup } from "@/lib/tags";
import {
  fetchGalleryFilterOptions,
  fetchRatedPhotos,
  type GalleryFilterOptions,
  type GalleryPhoto,
  type GallerySort,
} from "@/lib/photo-gallery";

const PAGE_SIZE = 60;

const SORT_LABELS: Record<GallerySort, string> = {
  rating_desc: "Highest rated",
  rating_asc: "Lowest rated",
  captured_desc: "Newest",
  captured_asc: "Oldest",
};

type Filters = {
  divisionId: string | null;
  locationId: string | null;
  campWeekId: string | null;
  minRating: number | null;
  tagIds: string[];
  sort: GallerySort;
};

const DEFAULT_FILTERS: Filters = {
  divisionId: null,
  locationId: null,
  campWeekId: null,
  minRating: 4,
  sort: "rating_desc",
  tagIds: [],
};

export function PhotoGalleryApp({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [options, setOptions] = React.useState<GalleryFilterOptions | null>(null);
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [photos, setPhotos] = React.useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const tagLabel = React.useMemo(
    () => buildTagLabelLookup(options?.tags ?? []),
    [options],
  );

  React.useEffect(() => {
    let cancelled = false;
    fetchGalleryFilterOptions(supabase)
      .then((o) => { if (!cancelled) setOptions(o); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load filters"); });
    return () => { cancelled = true; };
  }, [supabase]);

  // (Re)load page 0 whenever the filters change.
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRatedPhotos(supabase, { ...filters, offset: 0, limit: PAGE_SIZE })
      .then((rows) => {
        if (cancelled) return;
        setPhotos(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load photos"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, filters]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const rows = await fetchRatedPhotos(supabase, {
        ...filters,
        offset: photos.length,
        limit: PAGE_SIZE,
      });
      setPhotos((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : "Failed to load more", "x");
    } finally {
      setLoading(false);
    }
  };

  const patch = (next: Partial<Filters>) => setFilters((f) => ({ ...f, ...next }));

  const locationOptions = (options?.locations ?? []).filter(
    (l) => !filters.divisionId || l.divisionId === filters.divisionId,
  );

  // Weeks for the selected location, grouped by year (newest year first).
  const weeksByYear = React.useMemo(() => {
    const groups = new Map<string, { id: string; name: string }[]>();
    if (!filters.locationId) return groups;
    for (const w of options?.weeks ?? []) {
      if (w.locationId !== filters.locationId) continue;
      const year = w.startsOn ? w.startsOn.slice(0, 4) : "Undated";
      const list = groups.get(year) ?? [];
      list.push({ id: w.id, name: w.name });
      groups.set(year, list);
    }
    return new Map([...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  }, [options, filters.locationId]);

  const isFiltered =
    filters.divisionId !== null || filters.locationId !== null || filters.campWeekId !== null ||
    filters.tagIds.length > 0 || filters.minRating !== DEFAULT_FILTERS.minRating ||
    filters.sort !== DEFAULT_FILTERS.sort;

  // Lightbox neighbor preload (XL variant).
  React.useEffect(() => {
    if (lightboxIndex === null) return;
    for (const off of [-1, 1, 2]) {
      const p = photos[lightboxIndex + off];
      if (!p?.thumbnailUrl) continue;
      const xl = smugmugVariantUrl(p.thumbnailUrl, "XL");
      if (!xl) continue;
      const img = new window.Image();
      img.src = xl;
    }
  }, [lightboxIndex, photos]);

  const lightboxPhoto = lightboxIndex !== null ? photos[lightboxIndex] ?? null : null;

  return (
    <>
      <PageHeader
        eyebrow="Photo Library"
        title="Browse <em>rated photos</em>"
        sub="Find and download the best-rated camp photos for marketing."
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <Field label="Division">
            <select
              className="select"
              value={filters.divisionId ?? ""}
              onChange={(e) =>
                patch({ divisionId: e.target.value || null, locationId: null, campWeekId: null })
              }
            >
              <option value="">All divisions</option>
              {(options?.divisions ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Location">
            <SearchableSelect
              value={filters.locationId}
              options={locationOptions}
              placeholder="All locations"
              onChange={(id) => patch({ locationId: id, campWeekId: null })}
            />
          </Field>

          <Field label="Week">
            <select
              className="select"
              value={filters.campWeekId ?? ""}
              disabled={!filters.locationId}
              title={!filters.locationId ? "Select a location first" : undefined}
              onChange={(e) => patch({ campWeekId: e.target.value || null })}
            >
              <option value="">{filters.locationId ? "All weeks" : "Select a location first"}</option>
              {[...weeksByYear.entries()].map(([year, weeks]) => (
                <optgroup key={year} label={year}>
                  {weeks.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Min rating">
            <select
              className="select"
              value={filters.minRating ?? ""}
              onChange={(e) => patch({ minRating: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Any</option>
              <option value="5">5★ only</option>
              <option value="4">4★ &amp; up</option>
              <option value="3">3★ &amp; up</option>
              <option value="2">2★ &amp; up</option>
            </select>
          </Field>

          <Field label="Sort by">
            <select
              className="select"
              value={filters.sort}
              onChange={(e) => patch({ sort: e.target.value as GallerySort })}
            >
              {(Object.keys(SORT_LABELS) as GallerySort[]).map((s) => (
                <option key={s} value={s}>{SORT_LABELS[s]}</option>
              ))}
            </select>
          </Field>

          {isFiltered && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              style={{
                marginLeft: "auto", alignSelf: "flex-end",
                background: "none", border: "none", padding: "9px 0",
                color: "var(--ink-3)", fontSize: 12, cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Clear filters
            </button>
          )}

          {(options?.tags.length ?? 0) > 0 && (
            <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--ink-3)", marginRight: 4 }}>Tags:</span>
              {(options?.tags ?? []).map((t) => {
                const on = filters.tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={"btn " + (on ? "btn-primary" : "btn-ghost")}
                    style={{ padding: "5px 10px", fontSize: 12 }}
                    onClick={() =>
                      patch({
                        tagIds: on
                          ? filters.tagIds.filter((x) => x !== t.id)
                          : [...filters.tagIds, t.id],
                      })
                    }
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{error}</div>}

        {!loading && photos.length === 0 ? (
          <div className="card">No rated photos match these filters.</div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              {photos.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  aria-label={`${p.locationName} — ${p.weekName}${p.rating ? `, ${p.rating} stars` : ""}`}
                  style={{
                    position: "relative",
                    aspectRatio: "4 / 3",
                    padding: 0,
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid var(--rule)",
                    background: "var(--paper-3)",
                    cursor: "pointer",
                  }}
                >
                  <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
                  {p.rating != null && (
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
                      {p.rating}★
                    </div>
                  )}
                </button>
              ))}
            </div>

            {hasMore && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void loadMore()}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {lightboxPhoto && lightboxIndex !== null && (
        <GalleryLightbox
          photo={lightboxPhoto}
          tagLabel={tagLabel}
          position={`${lightboxIndex + 1} / ${photos.length}`}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < photos.length - 1}
          onClose={() => setLightboxIndex(null)}
          onPrev={() => setLightboxIndex((i) => (i === null || i <= 0 ? i : i - 1))}
          onNext={() => setLightboxIndex((i) => (i === null || i >= photos.length - 1 ? i : i + 1))}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, minWidth: 150 }}>
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      {children}
    </label>
  );
}

// Lightweight searchable single-select (no dependency). Shows the selected
// option's name when idle; typing filters the list. Used for Location, which
// grows long across all camps.
function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | null;
  options: { id: string; name: string }[];
  placeholder: string;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const selectedName = options.find((o) => o.id === value)?.name ?? "";

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        className="select"
        type="text"
        value={open ? query : selectedName}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        style={{ cursor: "pointer" }}
      />
      {open && (
        <div
          style={{
            position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 20,
            maxHeight: 260, overflowY: "auto",
            background: "var(--paper)", border: "1px solid var(--rule-2)",
            borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-md)",
          }}
        >
          <button
            type="button"
            className="select-option"
            style={selectOptionStyle(value === null)}
            onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
          >
            {placeholder}
          </button>
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              className="select-option"
              style={selectOptionStyle(o.id === value)}
              onClick={() => { onChange(o.id); setOpen(false); setQuery(""); }}
            >
              {o.name}
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--ink-3)" }}>No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

function selectOptionStyle(active: boolean): React.CSSProperties {
  return {
    display: "block", width: "100%", textAlign: "left",
    padding: "8px 12px", fontSize: 13, border: "none", cursor: "pointer",
    background: active ? "var(--paper-3)" : "transparent",
    color: "var(--ink)",
  };
}

function GalleryLightbox({
  photo,
  tagLabel,
  position,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
}: {
  photo: GalleryPhoto;
  tagLabel: (id: string) => string;
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  // One SmugMug !sizedetails call per opened photo, shared by the default
  // download button (for its label + dimensions) and the "More sizes" menu
  // (so it makes no further call). Browsing the grid stays API-free.
  const [sizes, setSizes] = React.useState<SizeOption[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setSizes(null);
    fetch(`/api/smugmug/download?photoId=${photo.id}&action=sizes`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && Array.isArray(j.sizes)) setSizes(j.sizes as SizeOption[]); })
      .catch(() => { /* default button falls back to a plain label */ });
    return () => { cancelled = true; };
  }, [photo.id]);

  const xlUrl = photo.thumbnailUrl ? smugmugVariantUrl(photo.thumbnailUrl, "XL") : null;
  const heroSrc = xlUrl ?? photo.imageUrl ?? photo.thumbnailUrl;
  const captured = photo.capturedAt
    ? new Date(photo.capturedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  // The stored image_url is SmugMug's "Original" rendition, so label the
  // default button with that size's real name + dimensions once known.
  const original = sizes?.find((s) => s.size === "O") ?? null;
  const dims = original?.width && original?.height ? ` · ${original.width}×${original.height}` : "";
  const defaultLabel = original ? `Download (${original.label}${dims})` : "Download Original";
  const otherSizes = (sizes ?? []).filter((s) => s.size !== "O");

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
          color: "white", fontFamily: "var(--font-mono)", fontSize: 12,
          letterSpacing: "0.08em", textTransform: "uppercase",
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
          border: "none", cursor: "pointer", display: "grid", placeItems: "center",
        }}
      >
        <Icon name="x" size={20} />
      </button>

      {hasPrev && (
        <button type="button" onClick={onPrev} aria-label="Previous photo" style={navBtnStyle("left")}>
          <Icon name="arrow-l" size={22} />
        </button>
      )}
      {hasNext && (
        <button type="button" onClick={onNext} aria-label="Next photo" style={navBtnStyle("right")}>
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
        <div style={{ position: "relative", width: "100%", height: "60vh", borderRadius: 8, overflow: "hidden" }}>
          <PhotoImg
            src={heroSrc}
            previewSrc={photo.thumbnailUrl}
            alt="Photo"
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
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 240, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <RatingStars rating={photo.rating ?? 0} />
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {photo.rating != null ? `${photo.rating} / 5` : "Unrated"}
              </span>
              {photo.ratedBy && (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>· rated by {photo.ratedBy}</span>
              )}
            </div>
            <div style={{ fontWeight: 600 }}>{photo.locationName} — {photo.weekName}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {[photo.divisionName, captured].filter(Boolean).join(" · ")}
            </div>
            {photo.tagIds.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {photo.tagIds.map((id) => (
                  <span
                    key={id}
                    style={{
                      fontSize: 11, padding: "3px 8px", borderRadius: 999,
                      background: "var(--paper-3)", border: "1px solid var(--rule)",
                    }}
                  >
                    {tagLabel(id)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", minWidth: 200 }}>
            <a
              className="btn btn-primary"
              href={`/api/smugmug/download?photoId=${photo.id}&stored=1`}
              rel="noopener"
              style={{ textAlign: "center" }}
            >
              <Icon name="download" size={16} />
              <span style={{ marginLeft: 6 }}>{defaultLabel}</span>
            </a>
            <DownloadMenu photoId={photo.id} sizes={otherSizes} loading={sizes === null} />
            {photo.smugmugUrl && (
              <a
                className="btn btn-ghost"
                href={photo.smugmugUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textAlign: "center" }}
              >
                View on SmugMug
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function navBtnStyle(side: "left" | "right"): React.CSSProperties {
  return {
    position: "absolute", top: "50%", [side]: 16, transform: "translateY(-50%)",
    width: 48, height: 48, borderRadius: 999,
    background: "rgba(255,255,255,0.12)", color: "white",
    border: "none", cursor: "pointer", display: "grid", placeItems: "center",
  };
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2, color: "var(--sun)" }} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ opacity: n <= rating ? 1 : 0.25 }}>
          <Icon name="stars" size={16} />
        </span>
      ))}
    </span>
  );
}

type SizeOption = { size: string; label: string; width: number | null; height: number | null };

// Presentational size menu. `sizes`/`loading` come from the one !sizedetails
// call the lightbox makes when it opens (shared with the default download
// button), so opening this menu costs no extra request. Browsing the grid
// makes no API calls at all.
function DownloadMenu({
  photoId,
  sizes,
  loading,
}: {
  photoId: string;
  sizes: SizeOption[] | null;
  loading: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // Open up or down depending on which side of the trigger has more room, and
  // cap the height to that space so the menu never spills off-screen.
  const [placement, setPlacement] = React.useState<{ dropUp: boolean; maxHeight: number }>({
    dropUp: false,
    maxHeight: 320,
  });
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = () => {
    const next = !open;
    if (next && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const dropUp = above > below;
      setPlacement({ dropUp, maxHeight: Math.max(160, Math.floor(dropUp ? above : below)) });
    }
    setOpen(next);
  };

  const download = (size: string) => {
    const a = document.createElement("a");
    a.href = `/api/smugmug/download?photoId=${photoId}&size=${size}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost"
        onClick={() => void toggle()}
        style={{ width: "100%" }}
      >
        More Sizes
      </button>
      {open && (
        <div
          style={{
            position: "absolute", right: 0, zIndex: 10,
            ...(placement.dropUp
              ? { bottom: "100%", marginBottom: 6 }
              : { top: "100%", marginTop: 6 }),
            maxHeight: placement.maxHeight, overflowY: "auto",
            minWidth: 200, background: "var(--paper-2)", border: "1px solid var(--rule)",
            borderRadius: 8, padding: 6, boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          }}
        >
          {loading && <div style={{ padding: 8, fontSize: 12, color: "var(--ink-3)" }}>Loading sizes…</div>}
          {!loading && sizes?.length === 0 && (
            <div style={{ padding: 8, fontSize: 12, color: "var(--ink-3)" }}>No sizes available.</div>
          )}
          {!loading && (sizes ?? []).map((s) => (
            <button
              key={s.size}
              type="button"
              className="btn btn-ghost"
              style={{ display: "block", width: "100%", textAlign: "left" }}
              onClick={() => download(s.size)}
            >
              {s.label}
              {s.width && s.height ? (
                <span style={{ color: "var(--ink-3)", fontSize: 11, marginLeft: 6 }}>
                  {s.width}×{s.height}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
