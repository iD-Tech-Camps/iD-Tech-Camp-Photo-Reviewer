import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminLocation = {
  id: string;
  name: string;
  evergreenNotes: string | null;
  // Sorted ascending. Used to bucket the location as active vs inactive
  // relative to the admin's season window (triage_config.season_*).
  weekStarts: string[];
};

type RawLocation = {
  id: string;
  name: string;
  evergreen_notes: string | null;
  camp_weeks: Array<{ starts_on: string }>;
};

export async function fetchLocationsForAdmin(
  supabase: SupabaseClient,
): Promise<AdminLocation[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, evergreen_notes, camp_weeks ( starts_on )")
    .order("name", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as RawLocation[]).map((loc) => ({
    id: loc.id,
    name: loc.name,
    evergreenNotes: loc.evergreen_notes,
    weekStarts: (loc.camp_weeks ?? [])
      .map((w) => w.starts_on)
      .sort((a, b) => a.localeCompare(b)),
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
