import type { SupabaseClient } from "@supabase/supabase-js";

export type LocationWithWeeks = {
  id: string;
  name: string;
  evergreenNotes: string | null;
  weeks: CampWeekAdminRow[];
};

export type CampWeekAdminRow = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  triageRole: string;
  isFirstWeekOverride: boolean | null;
};

type RawLocation = {
  id: string;
  name: string;
  evergreen_notes: string | null;
  camp_weeks: Array<{
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    triage_role: string;
    is_first_week_override: boolean | null;
  }>;
};

export async function fetchLocationsForAdmin(
  supabase: SupabaseClient,
): Promise<LocationWithWeeks[]> {
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id, name, evergreen_notes, " +
        "camp_weeks ( id, name, starts_on, ends_on, triage_role, is_first_week_override )",
    )
    .order("name", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as RawLocation[]).map((loc) => ({
    id: loc.id,
    name: loc.name,
    evergreenNotes: loc.evergreen_notes,
    weeks: (loc.camp_weeks ?? [])
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((w) => ({
        id: w.id,
        name: w.name,
        startsOn: w.starts_on,
        endsOn: w.ends_on,
        triageRole: w.triage_role,
        isFirstWeekOverride: w.is_first_week_override,
      })),
  }));
}

export async function updateEvergreenNotes(
  supabase: SupabaseClient,
  locationId: string,
  notes: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("locations")
    .update({ evergreen_notes: notes?.trim() || null })
    .eq("id", locationId);
  if (error) throw error;
}

export type FirstWeekOverrideValue = boolean | null;

export async function updateFirstWeekOverride(
  supabase: SupabaseClient,
  campWeekId: string,
  value: FirstWeekOverrideValue,
): Promise<void> {
  const { error } = await supabase
    .from("camp_weeks")
    .update({ is_first_week_override: value })
    .eq("id", campWeekId);
  if (error) throw error;
}
