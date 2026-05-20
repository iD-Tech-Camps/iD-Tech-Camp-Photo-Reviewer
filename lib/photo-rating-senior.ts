import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchCampWeekSeniorTagIds(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("camp_week_senior_tags")
    .select("tag_id")
    .eq("camp_week_id", campWeekId);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { tag_id: string }).tag_id);
}

export async function setCampWeekSeniorTags(
  supabase: SupabaseClient,
  campWeekId: string,
  tagIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc("photo_rating_set_week_tags", {
    p_camp_week_id: campWeekId,
    p_tag_ids: tagIds,
  });
  if (error) throw error;
}
