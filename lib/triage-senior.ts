import type { SupabaseClient } from "@supabase/supabase-js";
import type { TagCategory } from "@/lib/tags";

export type SeniorWeekSummary = {
  id: string;
  name: string;
  locationName: string;
  triageRole: string;
  triageState: string;
  positiveGreatQuality: boolean;
  positiveGreatVariety: boolean;
  positiveShininessGreat: boolean;
};

export type SeniorFlaggedPhoto = {
  id: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  caption: string | null;
  isQuarantined: boolean;
  tagIds: string[];
};

export type SeniorRollupWeek = {
  id: string;
  name: string;
  locationName: string;
  triageRole: string;
  triageState: string;
  startsOn: string;
  totalPhotos: number;
  pendingCount: number;
  inProgressCount: number;
  cleanCount: number;
  flaggedCount: number;
  deletedCount: number;
  quarantinedCount: number;
};

const ACTIVE_PIPELINE_STATES = [
  "photos_in",
  "triage_in_progress",
  "triage_done",
  "senior_review",
] as const;

export async function fetchSeniorRollupWeeks(
  supabase: SupabaseClient,
): Promise<SeniorRollupWeek[]> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select(
      "id, name, starts_on, triage_role, triage_state, " +
        "locations!inner ( name ), photos ( triage_state, is_quarantined )",
    )
    .in("triage_state", ACTIVE_PIPELINE_STATES as unknown as string[])
    .order("starts_on", { ascending: true });
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    starts_on: string;
    triage_role: string;
    triage_state: string;
    locations: { name: string } | null;
    photos: Array<{ triage_state: string; is_quarantined: boolean }>;
  };

  return ((data ?? []) as unknown as Raw[]).map((w) => {
    const photos = w.photos ?? [];
    let pending = 0;
    let inProgress = 0;
    let clean = 0;
    let flagged = 0;
    let deleted = 0;
    let quarantined = 0;
    for (const p of photos) {
      switch (p.triage_state) {
        case "pending": pending += 1; break;
        case "in_progress": inProgress += 1; break;
        case "clean": clean += 1; break;
        case "flagged": flagged += 1; break;
        case "deleted": deleted += 1; break;
        default: break;
      }
      if (p.is_quarantined) quarantined += 1;
    }
    return {
      id: w.id,
      name: w.name,
      locationName: w.locations?.name ?? "—",
      triageRole: w.triage_role,
      triageState: w.triage_state,
      startsOn: w.starts_on,
      totalPhotos: photos.length,
      pendingCount: pending,
      inProgressCount: inProgress,
      cleanCount: clean,
      flaggedCount: flagged,
      deletedCount: deleted,
      quarantinedCount: quarantined,
    };
  });
}

export async function fetchSeniorWeek(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<SeniorWeekSummary> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select(
      "id, name, triage_role, triage_state, " +
        "positive_great_quality, positive_great_variety, positive_shininess_great, " +
        "locations!inner ( name )",
    )
    .eq("id", campWeekId)
    .single();
  if (error) throw error;
  const raw = data as unknown as {
    id: string;
    name: string;
    triage_role: string;
    triage_state: string;
    positive_great_quality: boolean;
    positive_great_variety: boolean;
    positive_shininess_great: boolean;
    locations: { name: string } | null;
  };
  return {
    id: raw.id,
    name: raw.name,
    locationName: raw.locations?.name ?? "—",
    triageRole: raw.triage_role,
    triageState: raw.triage_state,
    positiveGreatQuality: raw.positive_great_quality,
    positiveGreatVariety: raw.positive_great_variety,
    positiveShininessGreat: raw.positive_shininess_great,
  };
}

export async function fetchFlaggedPhotosForWeek(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<SeniorFlaggedPhoto[]> {
  const { data: photos, error } = await supabase
    .from("photos")
    .select("id, thumbnail_url, image_url, caption, is_quarantined")
    .eq("camp_week_id", campWeekId)
    .eq("triage_state", "flagged")
    .order("captured_at", { ascending: true });
  if (error) throw error;

  const ids = (photos ?? []).map((p) => (p as { id: string }).id);
  if (ids.length === 0) return [];

  const { data: events, error: evErr } = await supabase
    .from("triage_events")
    .select("id, photo_id, triage_event_tags ( tag_id )")
    .in("photo_id", ids)
    .eq("kind", "flag")
    .order("created_at", { ascending: false });
  if (evErr) throw evErr;

  const tagsByPhoto = new Map<string, string[]>();
  for (const ev of events ?? []) {
    const e = ev as {
      photo_id: string;
      triage_event_tags: Array<{ tag_id: string }>;
    };
    if (!tagsByPhoto.has(e.photo_id)) {
      tagsByPhoto.set(
        e.photo_id,
        (e.triage_event_tags ?? []).map((t) => t.tag_id),
      );
    }
  }

  return ((photos ?? []) as Array<{
    id: string;
    thumbnail_url: string | null;
    image_url: string | null;
    caption: string | null;
    is_quarantined: boolean;
  }>).map((p) => ({
    id: p.id,
    thumbnailUrl: p.thumbnail_url,
    imageUrl: p.image_url,
    caption: p.caption,
    isQuarantined: p.is_quarantined,
    tagIds: tagsByPhoto.get(p.id) ?? [],
  }));
}

export async function fetchCategoryRollup(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<Record<TagCategory, number>> {
  const flagged = await fetchFlaggedPhotosForWeek(supabase, campWeekId);
  const allTagIds = [...new Set(flagged.flatMap((p) => p.tagIds))];
  if (allTagIds.length === 0) {
    return { quality: 0, setup: 0, brand: 0, safety: 0, general: 0 };
  }

  const { data: tags, error } = await supabase
    .from("tags")
    .select("id, category")
    .in("id", allTagIds);
  if (error) throw error;

  const catById = new Map(
    ((tags ?? []) as Array<{ id: string; category: TagCategory }>).map((t) => [t.id, t.category]),
  );

  const rollup: Record<TagCategory, number> = {
    quality: 0, setup: 0, brand: 0, safety: 0, general: 0,
  };
  for (const p of flagged) {
    for (const tid of p.tagIds) {
      const cat = catById.get(tid) ?? "general";
      rollup[cat] += 1;
    }
  }
  return rollup;
}
