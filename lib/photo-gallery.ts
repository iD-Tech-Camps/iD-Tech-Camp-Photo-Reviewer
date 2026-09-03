import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTags, type Tag } from "@/lib/tags";
import { seasonDateRange, seasonsFromDates } from "@/lib/seasons";

// Data layer for the marketing Photo Library screen — browse the rated pool of
// photos (rating_state = 'rated', not quarantined) with filters + sorting.
//
// "Current rating" is denormalized onto photos.current_rating (migration
// 20260603000047) so we can sort / filter / paginate server-side. Tags are
// read from the latest photo_rating_events row per photo.

export type GallerySort =
  | "rating_desc"
  | "rating_asc"
  | "captured_desc"
  | "captured_asc";

export type GalleryFilters = {
  // Calendar year of the week's starts_on. Null = every season. The rated pool
  // spans years (it always did for photos rated in past seasons, and migration
  // 52 will grow it substantially), so this is the coarse filter that keeps the
  // grid meaningful.
  season?: number | null;
  divisionId?: string | null;
  locationId?: string | null;
  campWeekId?: string | null;
  minRating?: number | null;
  tagIds?: string[];
  // Restrict to photos the given viewer has rated. `mineOnly` is the toggle;
  // `viewerId` is the reviewer to match (the signed-in user).
  mineOnly?: boolean;
  viewerId?: string | null;
  // Include "Hide from parent view" (is_quarantined) photos. Default false:
  // the gallery shows the marketing-visible pool. When true, hidden photos are
  // surfaced (badged) so they can be restored.
  showHidden?: boolean;
  sort: GallerySort;
  offset: number;
  limit: number;
};

export type GalleryPhoto = {
  id: string;
  rating: number | null;
  capturedAt: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  smugmugUrl: string | null;
  smugmugImageId: string;
  width: number | null;
  height: number | null;
  locationName: string;
  divisionName: string;
  weekName: string;
  weekStartsOn: string | null;
  isQuarantined: boolean;
  tagIds: string[];
  ratedBy: string | null;
  ratedById: string | null;
};

export type GalleryFilterOptions = {
  /** Season years present in the rated pool, newest first. */
  seasons: number[];
  divisions: { id: string; name: string }[];
  locations: { id: string; name: string; divisionId: string }[];
  weeks: { id: string; name: string; startsOn: string | null; locationId: string }[];
  tags: Tag[];
};

// Derive the filter dropdowns from the *rated* pool only — a division or
// location with no rated photos is noise (and was surfacing a stray empty
// "iD Tech Camps" division left over from dev-seed data). `camp_weeks` with a
// `photos!inner` filter returns only weeks that have a matching rated photo;
// the embedded photo array is capped at 1 so we don't drag every photo id back.
export async function fetchGalleryFilterOptions(
  supabase: SupabaseClient,
): Promise<GalleryFilterOptions> {
  const [weeksRes, tags] = await Promise.all([
    supabase
      .from("camp_weeks")
      .select(
        "id, name, starts_on, location_id, " +
          "locations!inner ( id, name, division_id, is_ignored, divisions!inner ( id, name ) ), " +
          "photos!inner ( id )",
      )
      .eq("photos.rating_state", "rated")
      .eq("photos.is_quarantined", false)
      .eq("locations.is_ignored", false)
      .limit(1, { referencedTable: "photos" })
      .order("starts_on", { ascending: true }),
    fetchTags(supabase, { purpose: "photo_rating" }),
  ]);

  if (weeksRes.error) throw weeksRes.error;

  const divisions = new Map<string, { id: string; name: string }>();
  const locations = new Map<string, { id: string; name: string; divisionId: string }>();
  const weeks: GalleryFilterOptions["weeks"] = [];

  for (const w of (weeksRes.data ?? []) as unknown as Array<{
    id: string;
    name: string;
    starts_on: string | null;
    location_id: string;
    locations: { id: string; name: string; division_id: string; divisions: { id: string; name: string } | null } | null;
  }>) {
    const loc = w.locations;
    const div = loc?.divisions;
    if (loc && div) {
      divisions.set(div.id, { id: div.id, name: div.name });
      locations.set(loc.id, { id: loc.id, name: loc.name, divisionId: loc.division_id });
    }
    weeks.push({ id: w.id, name: w.name, startsOn: w.starts_on, locationId: w.location_id });
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    seasons: seasonsFromDates(weeks.map((w) => w.startsOn)),
    divisions: [...divisions.values()].sort(byName),
    locations: [...locations.values()].sort(byName),
    weeks,
    tags,
  };
}

const SELECT_COLUMNS =
  "id, current_rating, captured_at, thumbnail_url, image_url, smugmug_url, " +
  "smugmug_image_id, width, height, is_quarantined, " +
  "camp_weeks!inner ( name, starts_on, locations!inner ( name, division_id, divisions!inner ( name ) ) )";

// Both the tag filter and "only my ratings" ask the same kind of question —
// does this photo have a rating event that matches — so they ride along as
// inner-joined embeds on this query instead of a list of photo ids resolved
// up front. Resolving ids first broke twice over on
// a tag as broad as a whole program: the list came back capped by PostgREST's
// max-rows (1000), silently dropping matches, and then `.in("id", …)` — whose
// values PostgREST puts in the URL — went past the length the edge proxy
// rejects with HTTP 400 (see lib/photo-rating-claims.ts).
//
// Each filter gets its own aliased embed, so the two stay independent
// existence checks: "carries this tag" AND "I rated it", not necessarily on
// the same event. Superseded events count, as before — re-rating is rare and
// keeps the same reviewer's tags. A photo with several matching events still
// comes back once; PostgREST nests the matches rather than fanning the row
// out, so `.range()` keeps paginating photos.
const TAGGED_EMBED = "tagged:photo_rating_events!inner ( photo_rating_event_tags!inner ( tag_id ) )";
const MINE_EMBED = "mine:photo_rating_events!inner ( reviewer_id )";

export async function fetchRatedPhotos(
  supabase: SupabaseClient,
  filters: GalleryFilters,
): Promise<GalleryPhoto[]> {
  const tagIds = filters.tagIds ?? [];
  const byTag = tagIds.length > 0;
  const mineOnlyFor = filters.mineOnly ? filters.viewerId ?? null : null;

  const select = [
    SELECT_COLUMNS,
    ...(byTag ? [TAGGED_EMBED] : []),
    ...(mineOnlyFor ? [MINE_EMBED] : []),
  ].join(", ");

  let query = supabase
    .from("photos")
    .select(select)
    .eq("rating_state", "rated")
    .eq("camp_weeks.locations.is_ignored", false);

  if (byTag) {
    query = query.in("tagged.photo_rating_event_tags.tag_id", tagIds);
  }
  if (mineOnlyFor) {
    query = query.eq("mine.reviewer_id", mineOnlyFor);
  }

  // Hidden-from-parent photos are excluded by default; the "Show hidden"
  // toggle opts them back in (badged in the grid) so they can be restored.
  if (!filters.showHidden) {
    query = query.eq("is_quarantined", false);
  }

  // Season narrows the embedded camp_weeks join, so it composes with the
  // division / location filters below rather than replacing them. A specific
  // week already implies its season, so skip the redundant bounds there.
  if (filters.season != null && !filters.campWeekId) {
    const { from, to } = seasonDateRange(filters.season);
    query = query
      .gte("camp_weeks.starts_on", from)
      .lte("camp_weeks.starts_on", to);
  }

  if (filters.campWeekId) {
    query = query.eq("camp_week_id", filters.campWeekId);
  } else if (filters.locationId) {
    query = query.eq("camp_weeks.location_id", filters.locationId);
  } else if (filters.divisionId) {
    query = query.eq("camp_weeks.locations.division_id", filters.divisionId);
  }

  if (filters.minRating != null) {
    query = query.gte("current_rating", filters.minRating);
  }

  const asc = filters.sort === "rating_asc" || filters.sort === "captured_asc";
  if (filters.sort === "rating_desc" || filters.sort === "rating_asc") {
    query = query
      .order("current_rating", { ascending: asc })
      .order("captured_at", { ascending: false });
  } else {
    query = query.order("captured_at", { ascending: asc, nullsFirst: false });
  }
  query = query.order("id", { ascending: true });

  query = query.range(filters.offset, filters.offset + filters.limit - 1);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    current_rating: number | null;
    captured_at: string | null;
    thumbnail_url: string | null;
    image_url: string | null;
    smugmug_url: string | null;
    smugmug_image_id: string;
    width: number | null;
    height: number | null;
    is_quarantined: boolean;
    camp_weeks: {
      name: string;
      starts_on: string | null;
      locations: { name: string; divisions: { name: string } | null } | null;
    } | null;
  }>;

  const photos: GalleryPhoto[] = rows.map((r) => ({
    id: r.id,
    rating: r.current_rating,
    capturedAt: r.captured_at,
    thumbnailUrl: r.thumbnail_url,
    imageUrl: r.image_url,
    smugmugUrl: r.smugmug_url,
    smugmugImageId: r.smugmug_image_id,
    width: r.width,
    height: r.height,
    weekName: r.camp_weeks?.name ?? "—",
    weekStartsOn: r.camp_weeks?.starts_on ?? null,
    isQuarantined: r.is_quarantined,
    locationName: r.camp_weeks?.locations?.name ?? "—",
    divisionName: r.camp_weeks?.locations?.divisions?.name ?? "—",
    tagIds: [],
    ratedBy: null,
    ratedById: null,
  }));

  // Attach current tags + "rated by" for this page from the latest event.
  const metaMap = await fetchGalleryPhotoMeta(supabase, photos.map((p) => p.id));
  for (const p of photos) {
    const meta = metaMap.get(p.id);
    p.tagIds = meta?.tagIds ?? [];
    p.ratedBy = meta?.ratedBy ?? null;
    p.ratedById = meta?.ratedById ?? null;
  }

  return photos;
}

// Rating correction (Photo Library). A behind-the-scenes update of the photo's
// current_rating via the gated route — attribution and the reviewer's event are
// left untouched; only the gallery's sort/display value changes. Allowed for
// seniors/admins (any photo) and a photo's own current rater (re-rating).
export async function overridePhotoRating(photoId: string, rating: number): Promise<void> {
  const res = await fetch("/api/photo-rating/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_id: photoId, rating }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `override failed (${res.status})`);
  }
}

// Bulk rating correction (Photo Library multi-select). Same semantics as
// overridePhotoRating but for many photos at once; restricted server-side to
// seniors/admins. Resolves to the number of photos actually updated.
export async function bulkOverridePhotoRating(
  photoIds: string[],
  rating: number,
): Promise<number> {
  const res = await fetch("/api/photo-rating/bulk-override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_ids: photoIds, rating }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `bulk override failed (${res.status})`);
  }
  const json = await res.json().catch(() => ({}));
  return Number(json.updated ?? 0);
}

// "Hide from parent view" toggle (Photo Library). Flips photos.is_quarantined
// — the same flag the rating + camp-review screens write — via the gated route,
// which also reconciles the SmugMug-side Hidden flag. Allowed for seniors/admins
// (any photo) and a photo's own current rater.
export async function setPhotoQuarantine(photoId: string, quarantined: boolean): Promise<void> {
  const res = await fetch("/api/photo-rating/quarantine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_id: photoId, quarantined }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `hide toggle failed (${res.status})`);
  }
}

// Bulk "Hide from parent view" toggle (Photo Library multi-select). Same
// semantics as setPhotoQuarantine but for many photos at once; restricted
// server-side to seniors/admins. Resolves to the number of photos updated.
export async function bulkSetPhotoQuarantine(
  photoIds: string[],
  quarantined: boolean,
): Promise<number> {
  const res = await fetch("/api/photo-rating/bulk-quarantine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photo_ids: photoIds, quarantined }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `bulk hide toggle failed (${res.status})`);
  }
  const json = await res.json().catch(() => ({}));
  return Number(json.updated ?? 0);
}

export type GalleryPhotoMeta = { tagIds: string[]; ratedBy: string | null; ratedById: string | null };

// photoId → { tag ids, reviewer name + id } from the latest rating event per photo.
export async function fetchGalleryPhotoMeta(
  supabase: SupabaseClient,
  photoIds: string[],
): Promise<Map<string, GalleryPhotoMeta>> {
  const out = new Map<string, GalleryPhotoMeta>();
  if (photoIds.length === 0) return out;

  const { data: events, error: evErr } = await supabase
    .from("photo_rating_events")
    .select("id, photo_id, reviewer_id, created_at, profiles ( full_name, email )")
    .in("photo_id", photoIds)
    .order("created_at", { ascending: false });
  if (evErr) throw evErr;

  const latestByPhoto = new Map<string, { eventId: string; ratedBy: string | null; ratedById: string | null }>();
  for (const row of (events ?? []) as unknown as Array<{
    id: string;
    photo_id: string;
    reviewer_id: string | null;
    profiles: { full_name: string | null; email: string | null } | null;
  }>) {
    if (latestByPhoto.has(row.photo_id)) continue;
    const p = row.profiles;
    latestByPhoto.set(row.photo_id, {
      eventId: row.id,
      ratedBy: p?.full_name || p?.email || null,
      ratedById: row.reviewer_id ?? null,
    });
  }

  const eventIds = [...latestByPhoto.values()].map((v) => v.eventId);
  const tagsByEvent = new Map<string, string[]>();
  if (eventIds.length > 0) {
    const { data: tagRows, error: tagErr } = await supabase
      .from("photo_rating_event_tags")
      .select("event_id, tag_id")
      .in("event_id", eventIds);
    if (tagErr) throw tagErr;
    for (const row of (tagRows ?? []) as Array<{ event_id: string; tag_id: string }>) {
      const list = tagsByEvent.get(row.event_id) ?? [];
      list.push(row.tag_id);
      tagsByEvent.set(row.event_id, list);
    }
  }

  for (const [photoId, v] of latestByPhoto) {
    out.set(photoId, { tagIds: tagsByEvent.get(v.eventId) ?? [], ratedBy: v.ratedBy, ratedById: v.ratedById });
  }
  return out;
}
