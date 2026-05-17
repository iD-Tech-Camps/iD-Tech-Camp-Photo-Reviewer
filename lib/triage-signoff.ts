import type { SupabaseClient } from "@supabase/supabase-js";

export async function signoffCampWeek(
  supabase: SupabaseClient,
  campWeekId: string,
  flagSecondWeekRecheck: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("triage_signoff_camp_week", {
    p_camp_week_id: campWeekId,
    p_flag_second_week_recheck: flagSecondWeekRecheck,
  });
  if (error) throw error;
}

export async function setPositiveAssessment(
  supabase: SupabaseClient,
  campWeekId: string,
  greatQuality: boolean,
  greatVariety: boolean,
  shininessGreat: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("triage_set_positive_assessment", {
    p_camp_week_id: campWeekId,
    p_great_quality: greatQuality,
    p_great_variety: greatVariety,
    p_shininess_great: shininessGreat,
  });
  if (error) throw error;
}
