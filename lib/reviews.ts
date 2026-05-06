import type { SupabaseClient } from "@supabase/supabase-js";

// One photo as the reviewer queue needs it. Camel-cased here so the UI doesn't
// have to think about Postgres conventions; the underlying columns are
// snake_case and joined out of `photos -> camp_weeks -> locations -> divisions`.
export type ReviewQueuePhoto = {
  id: string;                 // uuid
  smugmugImageId: string;     // stable string for placeholder palette
  caption: string | null;
  capturedAt: string | null;  // ISO timestamp
  width: number | null;
  height: number | null;
  campLabel: string;          // "iD Tech Camps · Adelphi University"
};

type RawPhotoRow = {
  id: string;
  smugmug_image_id: string;
  caption: string | null;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  camp_weeks: {
    name: string;
    locations: {
      name: string;
      divisions: { name: string } | null;
    } | null;
  } | null;
};

// Pulls the next batch of `pending` photos to review, joined to the folder
// hierarchy so the UI can show "Division · Location" without extra round-trips.
// Ordered by capture time so reviewers see chronological day-of-camp flow.
export async function fetchPendingPhotos(
  supabase: SupabaseClient,
  limit = 10,
): Promise<ReviewQueuePhoto[]> {
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, smugmug_image_id, caption, captured_at, width, height, " +
      "camp_weeks ( name, locations ( name, divisions ( name ) ) )",
    )
    .eq("current_status", "pending")
    .order("captured_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as unknown as RawPhotoRow[];

  return rows.map((p) => {
    const division = p.camp_weeks?.locations?.divisions?.name;
    const location = p.camp_weeks?.locations?.name;
    const campLabel = [division, location].filter(Boolean).join(" · ");
    return {
      id: p.id,
      smugmugImageId: p.smugmug_image_id,
      caption: p.caption,
      capturedAt: p.captured_at,
      width: p.width,
      height: p.height,
      campLabel,
    };
  });
}

// One flagged photo as the senior queue needs it. Includes the triggering
// flag review (the latest review on the photo, which by definition is a flag
// since photos.current_status = 'flagged' is maintained by trigger from the
// latest review's decision) plus the reviewer's display info and tag ids.
export type FlaggedQueueItem = {
  id: string;
  smugmugImageId: string;
  caption: string | null;
  capturedAt: string | null;
  width: number | null;
  height: number | null;
  divisionName: string | null;
  locationName: string | null;
  campWeekName: string | null;
  campWeekStarts: string | null;
  campWeekEnds: string | null;
  flagReview: {
    id: string;
    note: string | null;
    quarantine: boolean;
    createdAt: string;
    reviewerName: string | null;
    reviewerEmail: string | null;
    tagIds: string[];
  };
};

type RawFlaggedRow = {
  id: string;
  smugmug_image_id: string;
  caption: string | null;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  camp_weeks: {
    name: string;
    starts_on: string | null;
    ends_on: string | null;
    locations: {
      name: string;
      divisions: { name: string } | null;
    } | null;
  } | null;
  reviews: {
    id: string;
    decision: string;
    note: string | null;
    quarantine: boolean;
    created_at: string;
    profiles: { full_name: string | null; email: string | null } | null;
    review_tags: { tag_id: string }[];
  }[] | null;
};

export async function fetchFlaggedPhotos(
  supabase: SupabaseClient,
): Promise<FlaggedQueueItem[]> {
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, smugmug_image_id, caption, captured_at, width, height, " +
      "camp_weeks ( name, starts_on, ends_on, locations ( name, divisions ( name ) ) ), " +
      "reviews ( id, decision, note, quarantine, created_at, " +
        "profiles ( full_name, email ), review_tags ( tag_id ) )",
    )
    .eq("current_status", "flagged");

  if (error) throw error;

  const rows = (data ?? []) as unknown as RawFlaggedRow[];

  const items: FlaggedQueueItem[] = [];
  for (const p of rows) {
    const reviews = (p.reviews ?? []).slice().sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    // The latest review should be the active flag (the trigger keeps
    // current_status synced to the latest decision). Defend against drift
    // by skipping any photo whose latest review isn't a flag — that would
    // indicate trigger failure or manual DB editing.
    const latest = reviews[0];
    if (!latest || latest.decision !== "flag") continue;

    items.push({
      id: p.id,
      smugmugImageId: p.smugmug_image_id,
      caption: p.caption,
      capturedAt: p.captured_at,
      width: p.width,
      height: p.height,
      divisionName: p.camp_weeks?.locations?.divisions?.name ?? null,
      locationName: p.camp_weeks?.locations?.name ?? null,
      campWeekName: p.camp_weeks?.name ?? null,
      campWeekStarts: p.camp_weeks?.starts_on ?? null,
      campWeekEnds: p.camp_weeks?.ends_on ?? null,
      flagReview: {
        id: latest.id,
        note: latest.note,
        quarantine: latest.quarantine,
        createdAt: latest.created_at,
        reviewerName: latest.profiles?.full_name ?? null,
        reviewerEmail: latest.profiles?.email ?? null,
        tagIds: (latest.review_tags ?? []).map((t) => t.tag_id),
      },
    });
  }

  // Oldest flag first — seniors clear backlog top-down.
  items.sort(
    (a, b) => Date.parse(a.flagReview.createdAt) - Date.parse(b.flagReview.createdAt),
  );
  return items;
}

// Lightweight count for the sidebar badge. Cheaper than fetching the full
// flagged queue when all the UI needs is the number.
export async function fetchFlaggedCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("current_status", "flagged");
  if (error) throw error;
  return count ?? 0;
}

// Same idea for the reviewer queue — used by the sidebar Review badge and
// the HomeScreen subtitle template ({{count}} photos waiting). Photos hit
// `pending` status either at SmugMug import time (default) or when no
// review has touched them yet.
export async function fetchPendingCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("current_status", "pending");
  if (error) throw error;
  return count ?? 0;
}

export type SubmitReviewInput = {
  photoId: string;
  reviewerId: string;
  decision: "approve" | "flag" | "delete";
  rating?: number;
  note?: string;
  tags?: string[];
  quarantine?: boolean;
};

// Inserts a `reviews` row and (if any tags supplied) the matching `review_tags`
// rows. Two round-trips, not one — tags need the new review's id. If the tag
// insert fails after the review insert succeeds, the review still stands; the
// log is immutable by design (no update/delete RLS) so the only correction
// path is a new review row. Surface the error to the caller so they can
// decide how loud to be.
export async function submitReview(
  supabase: SupabaseClient,
  input: SubmitReviewInput,
): Promise<{ reviewId: string }> {
  const { data: review, error: reviewError } = await supabase
    .from("reviews")
    .insert({
      photo_id:     input.photoId,
      reviewer_id:  input.reviewerId,
      decision:     input.decision,
      rating:       input.rating ?? null,
      note:         input.note ?? null,
      quarantine:   input.quarantine ?? false,
    })
    .select("id")
    .single();

  if (reviewError) throw reviewError;
  if (!review) throw new Error("reviews insert returned no row");

  const tags = input.tags ?? [];
  if (tags.length > 0) {
    const rows = tags.map((tagId) => ({ review_id: review.id, tag_id: tagId }));
    const { error: tagsError } = await supabase.from("review_tags").insert(rows);
    if (tagsError) throw tagsError;
  }

  return { reviewId: review.id };
}
