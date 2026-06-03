import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTags, type Tag } from "@/lib/tags";

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
  divisionId?: string | null;
  locationId?: string | null;
  campWeekId?: string | null;
  minRating?: number | null;
  tagIds?: string[];
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
  tagIds: string[];
  ratedBy: string | null;
};

export type GalleryFilterOptions = {
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
          "locations!inner ( id, name, division_id, divisions!inner ( id, name ) ), " +
          "photos!inner ( id )",
      )
      .eq("photos.rating_state", "rated")
      .eq("photos.is_quarantined", false)
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
    divisions: [...divisions.values()].sort(byName),
    locations: [...locations.values()].sort(byName),
    weeks,
    tags,
  };
}

// Photos carrying a rating event tagged with any of `tagIds`. Semantics:
// "has a rating event carrying tag X" — superseded events count too, which is
// fine for browsing since re-rating is rare and keeps the same reviewer's tags.
async function fetchPhotoIdsForTags(
  supabase: SupabaseClient,
  tagIds: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from("photo_rating_event_tags")
    .select("tag_id, photo_rating_events!inner ( photo_id )")
    .in("tag_id", tagIds);
  if (error) throw error;
  const ids = new Set<string>();
  // The embedded relation is to-one, but PostgREST's generated types model it
  // as an array — normalize either shape.
  for (const row of (data ?? []) as unknown as Array<{
    photo_rating_events: { photo_id: string } | { photo_id: string }[] | null;
  }>) {
    const ev = row.photo_rating_events;
    const pid = Array.isArray(ev) ? ev[0]?.photo_id : ev?.photo_id;
    if (pid) ids.add(pid);
  }
  return [...ids];
}

const SELECT_COLUMNS =
  "id, current_rating, captured_at, thumbnail_url, image_url, smugmug_url, " +
  "smugmug_image_id, width, height, " +
  "camp_weeks!inner ( name, starts_on, locations!inner ( name, division_id, divisions!inner ( name ) ) )";

export async function fetchRatedPhotos(
  supabase: SupabaseClient,
  filters: GalleryFilters,
): Promise<GalleryPhoto[]> {
  // Resolve the tag pre-filter first; an empty result short-circuits the page.
  let tagPhotoIds: string[] | null = null;
  if (filters.tagIds && filters.tagIds.length > 0) {
    tagPhotoIds = await fetchPhotoIdsForTags(supabase, filters.tagIds);
    if (tagPhotoIds.length === 0) return [];
  }

  let query = supabase
    .from("photos")
    .select(SELECT_COLUMNS)
    .eq("rating_state", "rated")
    .eq("is_quarantined", false);

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

  if (tagPhotoIds) {
    query = query.in("id", tagPhotoIds);
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
    locationName: r.camp_weeks?.locations?.name ?? "—",
    divisionName: r.camp_weeks?.locations?.divisions?.name ?? "—",
    tagIds: [],
    ratedBy: null,
  }));

  // Attach current tags + "rated by" for this page from the latest event.
  const metaMap = await fetchGalleryPhotoMeta(supabase, photos.map((p) => p.id));
  for (const p of photos) {
    const meta = metaMap.get(p.id);
    p.tagIds = meta?.tagIds ?? [];
    p.ratedBy = meta?.ratedBy ?? null;
  }

  return photos;
}

export type GalleryPhotoMeta = { tagIds: string[]; ratedBy: string | null };

// photoId → { tag ids, reviewer name } from the latest rating event per photo.
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

  const latestByPhoto = new Map<string, { eventId: string; ratedBy: string | null }>();
  for (const row of (events ?? []) as unknown as Array<{
    id: string;
    photo_id: string;
    profiles: { full_name: string | null; email: string | null } | null;
  }>) {
    if (latestByPhoto.has(row.photo_id)) continue;
    const p = row.profiles;
    latestByPhoto.set(row.photo_id, {
      eventId: row.id,
      ratedBy: p?.full_name || p?.email || null,
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
    out.set(photoId, { tagIds: tagsByEvent.get(v.eventId) ?? [], ratedBy: v.ratedBy });
  }
  return out;
}
