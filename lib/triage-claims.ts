import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveClaim = {
  id: string;
  campWeekId: string;
  sliceSize: number;
  claimedAt: string;
};

export async function fetchActiveClaimsForReviewer(
  supabase: SupabaseClient,
  reviewerId: string,
): Promise<ActiveClaim[]> {
  const { data, error } = await supabase
    .from("triage_claims")
    .select("id, camp_week_id, slice_size, claimed_at")
    .eq("reviewer_id", reviewerId)
    .is("released_at", null)
    .order("claimed_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string;
    camp_week_id: string;
    slice_size: number;
    claimed_at: string;
  }>).map((r) => ({
    id: r.id,
    campWeekId: r.camp_week_id,
    sliceSize: r.slice_size,
    claimedAt: r.claimed_at,
  }));
}

export async function countActiveClaimsForReviewer(
  supabase: SupabaseClient,
  reviewerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("triage_claims")
    .select("id", { count: "exact", head: true })
    .eq("reviewer_id", reviewerId)
    .is("released_at", null);
  if (error) throw error;
  return count ?? 0;
}

export type ClaimPhoto = {
  id: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  caption: string | null;
  capturedAt: string | null;
  triageState: string;
};

export async function fetchClaimPhotos(
  supabase: SupabaseClient,
  claimId: string,
): Promise<ClaimPhoto[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("id, thumbnail_url, image_url, caption, captured_at, triage_state")
    .eq("triage_claim_id", claimId)
    .order("captured_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string;
    thumbnail_url: string | null;
    image_url: string | null;
    caption: string | null;
    captured_at: string | null;
    triage_state: string;
  }>).map((p) => ({
    id: p.id,
    thumbnailUrl: p.thumbnail_url,
    imageUrl: p.image_url,
    caption: p.caption,
    capturedAt: p.captured_at,
    triageState: p.triage_state,
  }));
}

export async function fetchWeekContext(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<{ weekName: string; locationName: string; evergreenNotes: string | null }> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select("name, locations!inner ( name, evergreen_notes )")
    .eq("id", campWeekId)
    .single();
  if (error) throw error;
  const raw = data as unknown as {
    name: string;
    locations: { name: string; evergreen_notes: string | null } | null;
  };
  return {
    weekName: raw.name,
    locationName: raw.locations?.name ?? "—",
    evergreenNotes: raw.locations?.evergreen_notes ?? null,
  };
}
