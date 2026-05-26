import type { SupabaseClient } from "@supabase/supabase-js";

export type PhotoRatingHubWeek = {
  id: string;
  name: string;
  locationName: string;
  ratingRole: string;
  ratingState: string;
  startsOn: string;
  endsOn: string;
  photoCount: number;
  pendingCount: number;
  inProgressCount: number;
};

export async function fetchPhotoRatingHubWeeks(
  supabase: SupabaseClient,
): Promise<PhotoRatingHubWeek[]> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select(
      "id, name, starts_on, ends_on, rating_role, rating_state, " +
        "locations!inner ( name ), photos ( rating_state )",
    )
    .not("rating_state", "in", '("not_required","complete")')
    .order("starts_on", { ascending: true });
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
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
