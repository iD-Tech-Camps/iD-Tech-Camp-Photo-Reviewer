import type { SupabaseClient } from "@supabase/supabase-js";

export async function signoffCampWeek(
  _supabase: SupabaseClient,
  campWeekId: string,
): Promise<void> {
  // Records the lead's per-week review as an audit marker (signoff_at /
  // signoff_by) via /api/triage/signoff. This is decoupled from location-level
  // approval, which closes the triage queue for the season — see
  // /api/locations/[id]/approve.
  const res = await fetch("/api/triage/signoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      camp_week_id: campWeekId,
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
