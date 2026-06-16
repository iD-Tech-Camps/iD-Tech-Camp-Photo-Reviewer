import type { SupabaseClient } from "@supabase/supabase-js";

export type TriageHubWeek = {
  id: string;
  name: string;
  locationName: string;
  triageRole: string;
  triageState: string;
  startsOn: string;
  endsOn: string;
  photoCount: number;
  pendingCount: number;
  inProgressCount: number;
};

export async function fetchTriageHubWeeks(
  supabase: SupabaseClient,
): Promise<TriageHubWeek[]> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select(
      "id, name, starts_on, ends_on, triage_role, triage_state, " +
        "locations!inner ( name, is_ignored ), photos ( triage_state )",
    )
    .not("triage_state", "in", '("not_required","complete")')
    // Once a lead has signed off on a week (per-week audit marker), it no
    // longer needs to surface on the reviewer hub — leads revisit signed-off
    // weeks from the dedicated Lead review hub. Keeping them here just adds
    // "Waiting for lead review" noise the lead has already cleared.
    .is("signoff_at", null)
    .eq("locations.is_ignored", false)
    .order("starts_on", { ascending: true });
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    triage_role: string;
    triage_state: string;
    locations: { name: string } | null;
    photos: Array<{ triage_state: string }>;
  };

  return ((data ?? []) as unknown as Raw[]).map((w) => {
    const photos = w.photos ?? [];
    return {
      id: w.id,
      name: w.name,
      locationName: w.locations?.name ?? "—",
      triageRole: w.triage_role,
      triageState: w.triage_state,
      startsOn: w.starts_on,
      endsOn: w.ends_on,
      photoCount: photos.length,
      pendingCount: photos.filter((p) => p.triage_state === "pending").length,
      inProgressCount: photos.filter((p) => p.triage_state === "in_progress").length,
    };
  });
}

export async function fetchWeekPendingCount(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("camp_week_id", campWeekId)
    .eq("triage_state", "pending");
  if (error) throw error;
  return count ?? 0;
}
