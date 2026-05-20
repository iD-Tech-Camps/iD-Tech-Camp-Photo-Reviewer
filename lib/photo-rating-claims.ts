import type { SupabaseClient } from "@supabase/supabase-js";

export type ActiveRatingClaim = {
  id: string;
  campWeekId: string;
  sliceSize: number;
  claimedAt: string;
};

export async function fetchActiveRatingClaimsForReviewer(
  supabase: SupabaseClient,
  reviewerId: string,
): Promise<ActiveRatingClaim[]> {
  const { data, error } = await supabase
    .from("photo_rating_claims")
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

export async function countActiveRatingClaimsForReviewer(
  supabase: SupabaseClient,
  reviewerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("photo_rating_claims")
    .select("id", { count: "exact", head: true })
    .eq("reviewer_id", reviewerId)
    .is("released_at", null);
  if (error) throw error;
  return count ?? 0;
}

export type RatingClaimPhoto = {
  id: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  caption: string | null;
  capturedAt: string | null;
  ratingState: string;
};

export async function fetchRatingClaimPhotos(
  supabase: SupabaseClient,
  claimId: string,
): Promise<RatingClaimPhoto[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("id, thumbnail_url, image_url, caption, captured_at, rating_state")
    .eq("rating_claim_id", claimId)
    .order("captured_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string;
    thumbnail_url: string | null;
    image_url: string | null;
    caption: string | null;
    captured_at: string | null;
    rating_state: string;
  }>).map((p) => ({
    id: p.id,
    thumbnailUrl: p.thumbnail_url,
    imageUrl: p.image_url,
    caption: p.caption,
    capturedAt: p.captured_at,
    ratingState: p.rating_state,
  }));
}

export async function fetchRatingWeekContext(
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

export type RatingEventSnapshot = {
  rating: number;
  tagIds: string[];
  quarantineIntent: boolean;
};

export async function fetchLatestRatingEventsForClaim(
  supabase: SupabaseClient,
  claimId: string,
  reviewerId: string,
): Promise<Map<string, RatingEventSnapshot>> {
  const { data: onClaim, error: photoErr } = await supabase
    .from("photos")
    .select("id")
    .eq("rating_claim_id", claimId);
  if (photoErr) throw photoErr;

  const { data: fromEvents, error: evPhotoErr } = await supabase
    .from("photo_rating_events")
    .select("photo_id")
    .eq("claim_id", claimId)
    .eq("reviewer_id", reviewerId);
  if (evPhotoErr) throw evPhotoErr;

  const photoIds = [
    ...new Set([
      ...(onClaim ?? []).map((p) => (p as { id: string }).id),
      ...(fromEvents ?? []).map((p) => (p as { photo_id: string }).photo_id),
    ]),
  ];
  if (photoIds.length === 0) return new Map();

  const { data: events, error: evErr } = await supabase
    .from("photo_rating_events")
    .select("id, photo_id, rating, quarantine_intent, created_at")
    .in("photo_id", photoIds)
    .eq("reviewer_id", reviewerId)
    .order("created_at", { ascending: false });
  if (evErr) throw evErr;

  const latestByPhoto = new Map<string, { id: string; rating: number; quarantineIntent: boolean }>();
  for (const row of events ?? []) {
    const e = row as {
      id: string;
      photo_id: string;
      rating: number;
      quarantine_intent: boolean;
    };
    if (!latestByPhoto.has(e.photo_id)) {
      latestByPhoto.set(e.photo_id, {
        id: e.id,
        rating: e.rating,
        quarantineIntent: e.quarantine_intent,
      });
    }
  }

  const eventIds = [...latestByPhoto.values()].map((e) => e.id);
  const tagMap = new Map<string, string[]>();
  if (eventIds.length > 0) {
    const { data: tagRows, error: tagErr } = await supabase
      .from("photo_rating_event_tags")
      .select("event_id, tag_id")
      .in("event_id", eventIds);
    if (tagErr) throw tagErr;
    for (const row of tagRows ?? []) {
      const t = row as { event_id: string; tag_id: string };
      const list = tagMap.get(t.event_id) ?? [];
      list.push(t.tag_id);
      tagMap.set(t.event_id, list);
    }
  }

  const out = new Map<string, RatingEventSnapshot>();
  for (const [photoId, ev] of latestByPhoto) {
    out.set(photoId, {
      rating: ev.rating,
      tagIds: tagMap.get(ev.id) ?? [],
      quarantineIntent: ev.quarantineIntent,
    });
  }
  return out;
}
