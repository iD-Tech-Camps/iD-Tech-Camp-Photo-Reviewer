import type { SupabaseClient } from "@supabase/supabase-js";

export async function signoffCampWeek(
  _supabase: SupabaseClient,
  campWeekId: string,
  flagSecondWeekRecheck: boolean,
): Promise<void> {
  // Routes through /api/triage/signoff (the dual-write shim) instead of the
  // legacy RPC. The shim approves the location for the season and also
  // writes the legacy camp_weeks signoff columns, so this works regardless
  // of the week's pre-approval triage_state. Phase 4 removes the shim
  // entirely once the UI fully migrates to location-level approve.
  const res = await fetch("/api/triage/signoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      camp_week_id: campWeekId,
      flag_second_week_recheck: flagSecondWeekRecheck,
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? json.message ?? `Sign-off failed (${res.status})`);
  }
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
