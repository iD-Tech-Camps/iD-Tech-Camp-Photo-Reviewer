import type { SupabaseClient } from "@supabase/supabase-js";

// Toggle a location's "ignored" flag (hides it from every review surface + the
// Photo Library). Routed through the set_location_ignored SECURITY DEFINER RPC
// so leads — who can't UPDATE locations directly under RLS — can hide test
// locations. Admins use it too (admin ⊆ senior_or_admin).
export async function setLocationIgnored(
  supabase: SupabaseClient,
  locationId: string,
  ignored: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_location_ignored", {
    p_location_id: locationId,
    p_ignored: ignored,
  });
  if (error) throw error;
}
