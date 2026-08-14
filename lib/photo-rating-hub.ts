import type { SupabaseClient } from "@supabase/supabase-js";
import { seasonDateRange, seasonsFromDates } from "@/lib/seasons";

export type PhotoRatingHubWeek = {
  id: string;
  name: string;
  locationId: string;
  locationName: string;
  ratingRole: string;
  ratingState: string;
  startsOn: string;
  endsOn: string;
  photoCount: number;
  pendingCount: number;
  inProgressCount: number;
};

// Season years that currently have hub-eligible weeks, newest first. Selects
// nothing but the date column — this deliberately skips the `photos` embed the
// hub query uses, because since migration 52 opened prior seasons the eligible
// set spans years and embedding every photo just to list years would pull tens
// of thousands of rows.
export async function fetchPhotoRatingSeasons(
  supabase: SupabaseClient,
): Promise<number[]> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select("starts_on, locations!inner ( is_ignored )")
    .not("rating_state", "in", '("not_required","complete")')
    .eq("locations.is_ignored", false);
  if (error) throw error;
  return seasonsFromDates(
    ((data ?? []) as unknown as Array<{ starts_on: string }>).map((r) => r.starts_on),
  );
}

// Scoped to one season. The season argument is required rather than optional:
// this query embeds every photo's rating_state per week, so an unbounded fetch
// across all seasons would be enormous now that prior years are rateable.
export async function fetchPhotoRatingHubWeeks(
  supabase: SupabaseClient,
  season: number | null,
): Promise<PhotoRatingHubWeek[]> {
  if (season === null) return [];
  const { from, to } = seasonDateRange(season);
  const { data, error } = await supabase
    .from("camp_weeks")
    .select(
      "id, name, location_id, starts_on, ends_on, rating_role, rating_state, " +
        "locations!inner ( name, is_ignored ), photos ( rating_state )",
    )
    .not("rating_state", "in", '("not_required","complete")')
    .eq("locations.is_ignored", false)
    .gte("starts_on", from)
    .lte("starts_on", to)
    .order("starts_on", { ascending: true });
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    location_id: string;
    starts_on: string;
    ends_on: string;
    rating_role: string;
    rating_state: string;
    locations: { name: string } | null;
    photos: Array<{ rating_state: string }>;
  };

  return ((data ?? []) as unknown as Raw[]).map((w) => {
    const photos = w.photos ?? [];
    return {
      id: w.id,
      name: w.name,
      locationId: w.location_id,
      locationName: w.locations?.name ?? "—",
      ratingRole: w.rating_role,
      ratingState: w.rating_state,
      startsOn: w.starts_on,
      endsOn: w.ends_on,
      photoCount: photos.length,
      pendingCount: photos.filter((p) => p.rating_state === "pending").length,
      inProgressCount: photos.filter((p) => p.rating_state === "in_progress").length,
    };
  });
}

export async function fetchRatingWeekPendingCount(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("camp_week_id", campWeekId)
    .eq("rating_state", "pending");
  if (error) throw error;
  return count ?? 0;
}
