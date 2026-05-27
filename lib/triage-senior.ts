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
  evergreenNotes: string | null;
  signoffAt: string | null;
  signoffByName: string | null;
};

export type SeniorWeekPhoto = {
  id: string;
  triageState: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  caption: string | null;
  isQuarantined: boolean;
  reviewerName: string | null;
  reviewerEmail: string | null;
  reviewedAt: string | null;
  tagIds: string[];
  quarantineIntent: boolean;
};

/** @deprecated Use SeniorWeekPhoto */
export type SeniorFlaggedPhoto = SeniorWeekPhoto;

export type SeniorRollupWeek = {
  id: string;
  name: string;
  locationName: string;
  triageRole: string;
  triageState: string;
  startsOn: string;
  endsOn: string;
  totalPhotos: number;
  pendingCount: number;
  inProgressCount: number;
  cleanCount: number;
  flaggedCount: number;
  deletedCount: number;
  quarantinedCount: number;
  signoffAt: string | null;
  signoffByName: string | null;
};

const LEAD_ELIGIBLE_ROLES = ["first_week", "second_week_recheck"] as const;

export async function fetchSeniorRollupWeeks(
  supabase: SupabaseClient,
): Promise<SeniorRollupWeek[]> {
  const { data, error } = await supabase
    .from("camp_weeks")
    .select(
      "id, name, starts_on, ends_on, triage_role, triage_state, signoff_at, " +
        "locations!inner ( name ), " +
        "signoff_profile:profiles!camp_weeks_signoff_by_fkey ( full_name ), " +
        "photos ( triage_state, is_quarantined )",
    )
    .in("triage_role", LEAD_ELIGIBLE_ROLES as unknown as string[])
    .neq("triage_state", "not_required")
    .order("starts_on", { ascending: true });
  if (error) throw error;

  type Raw = {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    triage_role: string;
    triage_state: string;
    signoff_at: string | null;
    locations: { name: string } | null;
    signoff_profile: { full_name: string | null } | null;
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
      endsOn: w.ends_on,
      totalPhotos: photos.length,
      pendingCount: pending,
      inProgressCount: inProgress,
      cleanCount: clean,
      flaggedCount: flagged,
      deletedCount: deleted,
      quarantinedCount: quarantined,
      signoffAt: w.signoff_at,
      signoffByName: w.signoff_profile?.full_name ?? null,
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
      "id, name, triage_role, triage_state, signoff_at, " +
        "positive_great_quality, positive_great_variety, positive_shininess_great, " +
        "locations!inner ( name, evergreen_notes ), " +
        "signoff_profile:profiles!camp_weeks_signoff_by_fkey ( full_name )",
    )
    .eq("id", campWeekId)
    .single();
  if (error) throw error;
  const raw = data as unknown as {
    id: string;
    name: string;
    triage_role: string;
    triage_state: string;
    signoff_at: string | null;
    positive_great_quality: boolean;
    positive_great_variety: boolean;
    positive_shininess_great: boolean;
    locations: { name: string; evergreen_notes: string | null } | null;
    signoff_profile: { full_name: string | null } | null;
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
    evergreenNotes: raw.locations?.evergreen_notes ?? null,
    signoffAt: raw.signoff_at,
    signoffByName: raw.signoff_profile?.full_name ?? null,
  };
}

type ReviewEventRow = {
  photo_id: string;
  kind: string;
  created_at: string;
  quarantine_intent: boolean;
  profiles: { full_name: string | null; email: string | null } | null;
  triage_event_tags: Array<{ tag_id: string }>;
};

function mapReviewEvent(e: ReviewEventRow) {
  return {
    reviewerName: e.profiles?.full_name ?? e.profiles?.email ?? null,
    reviewerEmail: e.profiles?.email ?? null,
    reviewedAt: e.created_at,
    tagIds: (e.triage_event_tags ?? []).map((t) => t.tag_id),
    quarantineIntent: e.quarantine_intent,
  };
}

export async function fetchWeekPhotosForSenior(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<SeniorWeekPhoto[]> {
  const { data: photos, error } = await supabase
    .from("photos")
    .select("id, triage_state, thumbnail_url, image_url, caption, is_quarantined")
    .eq("camp_week_id", campWeekId)
    .in("triage_state", ["pending", "in_progress", "clean", "flagged", "deleted"])
    .order("captured_at", { ascending: true });
  if (error) throw error;

  const rows = (photos ?? []) as Array<{
    id: string;
    triage_state: string;
    thumbnail_url: string | null;
    image_url: string | null;
    caption: string | null;
    is_quarantined: boolean;
  }>;
  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id);
  const { data: events, error: evErr } = await supabase
    .from("triage_events")
    .select(
      "photo_id, kind, created_at, quarantine_intent, " +
        "profiles ( full_name, email ), triage_event_tags ( tag_id )",
    )
    .in("photo_id", ids)
    .in("kind", ["clean", "flag"])
    .order("created_at", { ascending: false });
  if (evErr) throw evErr;

  const eventByPhoto = new Map<string, ReturnType<typeof mapReviewEvent>>();
  for (const ev of (events ?? []) as unknown as ReviewEventRow[]) {
    if (!eventByPhoto.has(ev.photo_id)) {
      eventByPhoto.set(ev.photo_id, mapReviewEvent(ev));
    }
  }

  return rows.map((p) => {
    const review = eventByPhoto.get(p.id);
    return {
      id: p.id,
      triageState: p.triage_state,
      thumbnailUrl: p.thumbnail_url,
      imageUrl: p.image_url,
      caption: p.caption,
      isQuarantined: p.is_quarantined,
      reviewerName: review?.reviewerName ?? null,
      reviewerEmail: review?.reviewerEmail ?? null,
      reviewedAt: review?.reviewedAt ?? null,
      tagIds: review?.tagIds ?? [],
      quarantineIntent: review?.quarantineIntent ?? false,
    };
  });
}

export async function fetchFlaggedPhotosForWeek(
  supabase: SupabaseClient,
  campWeekId: string,
): Promise<SeniorWeekPhoto[]> {
  const all = await fetchWeekPhotosForSenior(supabase, campWeekId);
  return all.filter((p) => p.triageState === "flagged");
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
    ((tags ?? []) as Array<{ id: string; category: TagCategory | null }>)
      .map((t) => [t.id, t.category ?? "general"] as const),
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
