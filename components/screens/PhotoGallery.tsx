"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PhotoImg } from "@/components/PhotoImg";
import { ReviewLightbox } from "@/components/ReviewLightbox";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";
import { buildTagLabelLookup } from "@/lib/tags";
import {
  bulkOverridePhotoRating,
  fetchGalleryFilterOptions,
  fetchRatedPhotos,
  overridePhotoRating,
  type GalleryFilterOptions,
  type GalleryPhoto,
  type GallerySort,
} from "@/lib/photo-gallery";

// Max photos the .zip download accepts in one request (mirrors the server cap
// in app/api/smugmug/download-zip). Selecting more disables the zip action.
const ZIP_MAX = 60;

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
  mineOnly: boolean;
  sort: GallerySort;
};

const DEFAULT_FILTERS: Filters = {
  divisionId: null,
  locationId: null,
  campWeekId: null,
  minRating: 4,
  sort: "rating_desc",
  tagIds: [],
  mineOnly: false,
};

export function PhotoGalleryApp({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const viewer = useCurrentUser();
  const viewerId = viewer.id;
  const canEditRating = viewer.role === "senior" || viewer.role === "admin";
  const [options, setOptions] = React.useState<GalleryFilterOptions | null>(null);
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [photos, setPhotos] = React.useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Multi-select mode + bulk actions.
  const [selectMode, setSelectMode] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [actionBusy, setActionBusy] = React.useState<null | "zip" | "rating">(null);
  const [galleryOpen, setGalleryOpen] = React.useState(false);

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
    fetchRatedPhotos(supabase, { ...filters, viewerId, offset: 0, limit: PAGE_SIZE })
      .then((rows) => {
        if (cancelled) return;
        setPhotos(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load photos"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supabase, filters, viewerId]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const rows = await fetchRatedPhotos(supabase, {
        ...filters,
        viewerId,
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

  // --- Multi-select ---------------------------------------------------------
  // `selected` is keyed by photo id (not array index), so paging in more
  // photos via "Load more" never disturbs the current selection.
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());
  const selectAllLoaded = () => setSelected(new Set(photos.map((p) => p.id)));
  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };
  const selectedCount = selected.size;
  const overZipCap = selectedCount > ZIP_MAX;

  const runZip = async () => {
    setActionBusy("zip");
    try {
      const res = await fetch("/api/smugmug/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: [...selected] }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Download failed (${res.status})`);
      }
      const skipped = Number(res.headers.get("X-Zip-Skipped") ?? 0);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `idtech-photos-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.show(
        skipped > 0 ? `Download ready (${skipped} skipped)` : "Download ready",
        "download",
      );
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : "Download failed", "x");
    } finally {
      setActionBusy(null);
    }
  };

  // Creates the gallery and resolves to its shareable URL. The dialog owns the
  // title input, busy/error UI, and the success view with the clickable link.
  const createGallery = async (name: string): Promise<string> => {
    const res = await fetch("/api/smugmug/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_ids: [...selected], name }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) {
      throw new Error(json.error ?? `Couldn't create gallery (${res.status})`);
    }
    return json.url as string;
  };

  const runBulkRating = async (rating: number) => {
    setActionBusy("rating");
    const ids = [...selected];
    try {
      const updated = await bulkOverridePhotoRating(ids, rating);
      // Optimistically patch the loaded grid so badges update immediately.
      const idSet = new Set(ids);
      setPhotos((prev) => prev.map((p) => (idSet.has(p.id) ? { ...p, rating } : p)));
      toast.show(`Updated ${updated} photo${updated === 1 ? "" : "s"} to ${rating}★`, "check");
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : "Couldn't change rating", "x");
    } finally {
      setActionBusy(null);
    }
  };

  // Senior/admin rating correction — a behind-the-scenes edit of the rating
  // used for sorting/display. Attribution ("rated by") is intentionally left
  // unchanged; only the star value updates.
  const overrideRating = async (photoId: string, rating: number): Promise<boolean> => {
    try {
      await overridePhotoRating(photoId, rating);
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, rating } : p)),
      );
      toast.show(`Rating corrected to ${rating}★`, "check");
      return true;
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : "Couldn't change rating", "x");
      return false;
    }
  };

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
    filters.mineOnly || filters.sort !== DEFAULT_FILTERS.sort;

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

          <label
            style={{
              display: "flex", alignItems: "center", gap: 6,
              alignSelf: "flex-end", padding: "9px 0", fontSize: 13,
              cursor: viewerId ? "pointer" : "not-allowed",
              color: viewerId ? "var(--ink)" : "var(--ink-3)",
            }}
            title={viewerId ? undefined : "Sign-in still loading"}
          >
            <input
              type="checkbox"
              checked={filters.mineOnly}
              disabled={!viewerId}
              onChange={(e) => patch({ mineOnly: e.target.checked })}
            />
            Show only my ratings
          </label>

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

        <div
          className="card"
          style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}
        >
          {!selectMode ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelectMode(true)}
              disabled={photos.length === 0}
            >
              <Icon name="check" size={16} />
              <span style={{ marginLeft: 6 }}>Select photos</span>
            </button>
          ) : (
            <>
              <span style={{ fontSize: 13, color: overZipCap ? "var(--rose)" : "var(--ink-2)" }}>
                {selectedCount} selected
              </span>
              <button
                type="button"
                onClick={selectAllLoaded}
                style={linkBtnStyle}
              >
                Select all loaded
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedCount === 0}
                style={{ ...linkBtnStyle, opacity: selectedCount === 0 ? 0.5 : 1 }}
              >
                Clear
              </button>

              <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {overZipCap && (
                  <span style={{ fontSize: 11, color: "var(--rose)" }}>Max {ZIP_MAX} for download</span>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void runZip()}
                  disabled={selectedCount === 0 || overZipCap || actionBusy !== null}
                  title={overZipCap ? `Select ${ZIP_MAX} or fewer to download` : undefined}
                >
                  <Icon name="download" size={16} />
                  <span style={{ marginLeft: 6 }}>{actionBusy === "zip" ? "Zipping…" : "Download .zip"}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setGalleryOpen(true)}
                  disabled={selectedCount === 0 || actionBusy !== null}
                >
                  <Icon name="image" size={16} />
                  <span style={{ marginLeft: 6 }}>Create SmugMug gallery</span>
                </button>
                {canEditRating && (
                  <BulkRatingMenu
                    disabled={selectedCount === 0 || actionBusy !== null}
                    busy={actionBusy === "rating"}
                    onPick={(n) => void runBulkRating(n)}
                  />
                )}
                <button type="button" className="btn btn-ghost" onClick={exitSelectMode}>
                  Done
                </button>
              </div>
            </>
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
              {photos.map((p, idx) => {
                const isSelected = selected.has(p.id);
                return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => (selectMode ? toggleSelect(p.id) : setLightboxIndex(idx))}
                  aria-label={
                    selectMode
                      ? `${isSelected ? "Deselect" : "Select"} ${p.locationName} — ${p.weekName}`
                      : `${p.locationName} — ${p.weekName}${p.rating ? `, ${p.rating} stars` : ""}`
                  }
                  aria-pressed={selectMode ? isSelected : undefined}
                  style={{
                    position: "relative",
                    aspectRatio: "4 / 3",
                    padding: 0,
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid var(--rule)",
                    background: "var(--paper-3)",
                    cursor: "pointer",
                    outline: selectMode && isSelected ? "3px solid var(--sun)" : "none",
                    outlineOffset: -3,
                  }}
                >
                  <PhotoImg src={p.thumbnailUrl ?? p.imageUrl} alt="" fit="cover" />
                  {selectMode && (
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        display: "grid",
                        placeItems: "center",
                        background: isSelected ? "var(--sun)" : "rgba(255,255,255,0.85)",
                        border: "1px solid var(--rule)",
                        color: "white",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                      }}
                    >
                      {isSelected && <Icon name="check" size={14} />}
                    </div>
                  )}
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
                );
              })}
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
          canEditRating={canEditRating || (!!viewerId && lightboxPhoto.ratedById === viewerId)}
          onOverrideRating={(rating) => overrideRating(lightboxPhoto.id, rating)}
        />
      )}

      {galleryOpen && (
        <GalleryCreateDialog
          count={selectedCount}
          onCreate={createGallery}
          onClose={() => setGalleryOpen(false)}
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

const linkBtnStyle: React.CSSProperties = {
  background: "none", border: "none", padding: "4px 0",
  color: "var(--ink-3)", fontSize: 12, cursor: "pointer", textDecoration: "underline",
};

// 1–5 rating buttons, shared by the lightbox "Change" editor and the
// multi-select toolbar's bulk "Change rating" popover. `current` highlights the
// active value (null in the bulk case, where photos may differ).
function RatingPicker({
  current,
  busy,
  onPick,
}: {
  current: number | null;
  busy?: boolean;
  onPick: (n: number) => void;
}) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={busy}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onPick(n)}
          style={{
            display: "grid", placeItems: "center",
            width: 30, height: 30, borderRadius: 6, cursor: "pointer",
            border: "1px solid var(--rule-2)",
            background: n === current ? "var(--sun)" : "var(--paper)",
            color: n === current ? "white" : "var(--ink-2)",
          }}
        >
          {n}
        </button>
      ))}
    </>
  );
}

// Bulk "Change rating" trigger + popover for the multi-select toolbar. Modeled
// on DownloadMenu's outside-click pattern.
function BulkRatingMenu({
  disabled,
  busy,
  onPick,
}: {
  disabled: boolean;
  busy: boolean;
  onPick: (n: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="stars" size={16} />
        <span style={{ marginLeft: 6 }}>{busy ? "Updating…" : "Change rating"}</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 10,
            display: "flex", gap: 6, alignItems: "center",
            background: "var(--paper-2)", border: "1px solid var(--rule)",
            borderRadius: 8, padding: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          }}
        >
          <RatingPicker current={null} busy={busy} onPick={(n) => { onPick(n); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

// Auto-suggested gallery title, e.g. "Selected Photos 2026-06-10 14-32". Mirrors
// the server-side default in lib/smugmug/collections.ts.
function suggestGalleryName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Selected Photos ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

// Two-phase modal for the "Create SmugMug gallery" bulk action:
//   compose → editable auto-suggested title + Create
//   created → success view with a clickable link (opens in a new tab)
function GalleryCreateDialog({
  count,
  onCreate,
  onClose,
}: {
  count: number;
  onCreate: (name: string) => Promise<string>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(() => suggestGalleryName());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await onCreate(name.trim() || suggestGalleryName());
      setCreatedUrl(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't create gallery");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "grid", placeItems: "center", padding: 24,
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: 440,
          background: "var(--paper)", border: "1px solid var(--rule)",
          borderRadius: 12, padding: 20, boxShadow: "var(--shadow-md)",
        }}
      >
        {createdUrl ? (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Gallery created</h2>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-3)" }}>
              Your Unlisted gallery is ready — anyone with the link can view it.
            </p>
            <a
              className="btn btn-primary"
              href={createdUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}
            >
              <Icon name="image" size={16} />
              <span style={{ marginLeft: 6 }}>Open gallery</span>
            </a>
            <div style={{ fontSize: 11, color: "var(--ink-3)", wordBreak: "break-all", marginBottom: 16 }}>
              {createdUrl}
            </div>
            <button type="button" className="btn btn-ghost" style={{ width: "100%" }} onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Create SmugMug gallery</h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--ink-3)" }}>
              {count} photo{count === 1 ? "" : "s"} will be gathered into a new Unlisted,
              link-shareable gallery.
            </p>
            <label style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
              Gallery title
            </label>
            <input
              className="select"
              type="text"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) void submit(); }}
              style={{ width: "100%", marginBottom: error ? 6 : 16 }}
            />
            {error && <div style={{ color: "var(--rose)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
                {busy ? "Creating…" : "Create gallery"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
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
  canEditRating,
  onOverrideRating,
}: {
  photo: GalleryPhoto;
  tagLabel: (id: string) => string;
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  canEditRating: boolean;
  onOverrideRating: (rating: number) => Promise<boolean>;
}) {
  const [editingRating, setEditingRating] = React.useState(false);
  const [savingRating, setSavingRating] = React.useState(false);
  // Reset the editor when navigating between photos.
  React.useEffect(() => { setEditingRating(false); }, [photo.id]);

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
    <ReviewLightbox
      heroSrc={heroSrc}
      previewSrc={photo.thumbnailUrl}
      alt="Photo"
      position={position}
      hasPrev={hasPrev}
      hasNext={hasNext}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <RatingStars rating={photo.rating ?? 0} />
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {photo.rating != null ? `${photo.rating} / 5` : "Unrated"}
        </span>
        {photo.ratedBy && (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>· rated by {photo.ratedBy}</span>
        )}
        {canEditRating && !editingRating && (
          <button
            type="button"
            onClick={() => setEditingRating(true)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: "var(--lake, var(--ink-2))", fontSize: 12, textDecoration: "underline",
            }}
          >
            Change
          </button>
        )}
      </div>
      {canEditRating && editingRating && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Set rating:</span>
          <RatingPicker
            current={photo.rating}
            busy={savingRating}
            onPick={async (n) => {
              setSavingRating(true);
              const ok = await onOverrideRating(n);
              setSavingRating(false);
              if (ok) setEditingRating(false);
            }}
          />
          <button
            type="button"
            disabled={savingRating}
            onClick={() => setEditingRating(false)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: "var(--ink-3)", fontSize: 12, marginLeft: 4,
            }}
          >
            Cancel
          </button>
        </div>
      )}
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
    </ReviewLightbox>
  );
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
  // Anchored with position:fixed (viewport coords) rather than absolute, so the
  // menu escapes the lightbox sidebar's scroll/overflow clipping. Opens up or
  // down depending on which side of the trigger has more room, capped to it.
  const [menuPos, setMenuPos] = React.useState<{
    left: number; top: number | null; bottom: number | null; maxHeight: number;
  }>({ left: 0, top: null, bottom: null, maxHeight: 320 });
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
      setMenuPos({
        // Right-align the menu to the trigger's right edge (translateX(-100%)).
        left: rect.right,
        top: dropUp ? null : rect.bottom + 6,
        bottom: dropUp ? window.innerHeight - rect.top + 6 : null,
        maxHeight: Math.max(160, Math.floor(dropUp ? above : below)),
      });
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
            position: "fixed", zIndex: 1100,
            left: menuPos.left, transform: "translateX(-100%)",
            ...(menuPos.top !== null ? { top: menuPos.top } : { bottom: menuPos.bottom ?? 0 }),
            maxHeight: menuPos.maxHeight, overflowY: "auto",
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
