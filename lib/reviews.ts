import type { SupabaseClient } from "@supabase/supabase-js";
import { photoImageProxyUrl } from "./photo-image-url";

// One photo as the reviewer queue needs it. Camel-cased here so the UI doesn't
// have to think about Postgres conventions; the underlying columns are
// snake_case and joined out of `photos -> camp_weeks -> locations -> divisions`.
//
// The three URL fields are populated by the 8.4 photo-sync engine:
//   - `imageUrl`     → SmugMug `ArchivedUri` (highest-fidelity URL the basic
//     image payload exposes without a follow-up `!sizes` call); used by the
//     reviewer hero and the senior detail card.
//   - `thumbnailUrl` → SmugMug `ThumbnailUrl`; used everywhere a small thumb
//     is enough (HomeScreen hero strip, FlagReview queue list, AdminSmugMug
//     queue card).
//   - `smugmugUrl`   → public SmugMug page; not rendered yet, but kept on the
//     type so the senior "open in SmugMug" affordance lands without another
//     query change.
export type ReviewQueuePhoto = {
  id: string;                 // uuid
  smugmugImageId: string;     // stable string, used as react key + alt fallback
  caption: string | null;
  capturedAt: string | null;  // ISO timestamp
  width: number | null;
  height: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  smugmugUrl: string | null;
  campLabel: string;          // "iD Tech Camps · Adelphi University"
};

type RawPhotoRow = {
  id: string;
  smugmug_image_id: string;
  caption: string | null;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  image_url: string | null;
  thumbnail_url: string | null;
  smugmug_url: string | null;
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
//
// Ordering reflects the live `smugmug_config` posture (set by step 8.5):
//   - `priority desc` floats admin-prioritized photos to the top
//     (Admin → SmugMug → Prioritize in queue stamps `priority = 1`).
//   - `captured_at <queueOrder>` follows the admin-chosen direction
//     (`newest_first` is summer-default; `oldest_first` is the chronological
//     flow option).
//
// This is the query the partial composite index `photos_pending_priority_idx`
// (migration 21) is shaped for — `(priority desc, captured_at) where current_status = 'pending'`.
export async function fetchPendingPhotos(
  supabase: SupabaseClient,
  limit = 10,
  queueOrder: "newest_first" | "oldest_first" = "newest_first",
): Promise<ReviewQueuePhoto[]> {
  const ascending = queueOrder === "oldest_first";
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, smugmug_image_id, caption, captured_at, width, height, " +
      "image_url, thumbnail_url, smugmug_url, " +
      "camp_weeks ( name, locations ( name, divisions ( name ) ) )",
    )
    .eq("current_status", "pending")
    .order("priority",    { ascending: false })
    .order("captured_at", { ascending, nullsFirst: false })
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
      imageUrl: photoImageProxyUrl(p.id, p.image_url, "full"),
      thumbnailUrl: photoImageProxyUrl(p.id, p.thumbnail_url, "thumb"),
      smugmugUrl: p.smugmug_url,
      campLabel,
    };
  });
}

// Decorative-strip variant: pulls a small batch of recent pending photos for
// the HomeScreen hero. Same ordering as the reviewer queue (priority desc,
// captured_at <queueOrder>) so the strip doubles as a preview of "what's
// coming up next" rather than a random sample. Returns just thumbnails +
// id; callers don't need the full review payload.
export type HeroThumb = {
  id: string;
  thumbnailUrl: string | null;
};

export async function fetchRecentPhotoThumbs(
  supabase: SupabaseClient,
  limit = 10,
  queueOrder: "newest_first" | "oldest_first" = "newest_first",
): Promise<HeroThumb[]> {
  const ascending = queueOrder === "oldest_first";
  const { data, error } = await supabase
    .from("photos")
    .select("id, thumbnail_url")
    .eq("current_status", "pending")
    .not("thumbnail_url", "is", null)
    .order("priority",    { ascending: false })
    .order("captured_at", { ascending, nullsFirst: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as { id: string; thumbnail_url: string | null }[]).map((r) => ({
    id: r.id,
    thumbnailUrl: photoImageProxyUrl(r.id, r.thumbnail_url, "thumb"),
  }));
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
  imageUrl: string | null;
  thumbnailUrl: string | null;
  smugmugUrl: string | null;
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
  image_url: string | null;
  thumbnail_url: string | null;
  smugmug_url: string | null;
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
      "image_url, thumbnail_url, smugmug_url, " +
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
      imageUrl: photoImageProxyUrl(p.id, p.image_url, "full"),
      thumbnailUrl: photoImageProxyUrl(p.id, p.thumbnail_url, "thumb"),
      smugmugUrl: p.smugmug_url,
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
  // When supplied, written verbatim into reviews.points_awarded. When
  // omitted (or 0), the reviews_snapshot_points trigger fills it in from
  // points_config at insert time. ReviewScreen passes an explicit value
  // so an active Points Multiplier Bonus is reflected in the DB snapshot
  // (the trigger doesn't know about bonuses — that lives in the client).
  pointsAwarded?: number;
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
  const insertRow: Record<string, unknown> = {
    photo_id:    input.photoId,
    reviewer_id: input.reviewerId,
    decision:    input.decision,
    rating:      input.rating ?? null,
    note:        input.note ?? null,
    quarantine:  input.quarantine ?? false,
  };
  // Only set points_awarded when the caller supplied a non-zero value.
  // The trigger's "if 0/null then snapshot from points_config" branch
  // is the safety net for the FlagReview senior actions, which don't
  // run through the bonus pennant.
  if (typeof input.pointsAwarded === "number" && input.pointsAwarded > 0) {
    insertRow.points_awarded = input.pointsAwarded;
  }

  const { data: review, error: reviewError } = await supabase
    .from("reviews")
    .insert(insertRow)
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
