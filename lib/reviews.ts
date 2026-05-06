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
