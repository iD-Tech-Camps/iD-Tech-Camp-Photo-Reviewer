import type { SupabaseClient } from "@supabase/supabase-js";

// Read helper for the Admin → SmugMug queue list. The reviewer queue
// (lib/reviews.ts → fetchPendingPhotos) is intentionally tighter — it
// only returns the next batch with the camp label flattened. This view
// is the admin-facing one: paginated, filterable, full row contents,
// includes terminal-status photos when filter='all' so admins can
// audit recent activity in context.
export type QueueRow = {
  id: string;
  smugmugImageId: string;
  thumbnailUrl: string | null;
  smugmugUrl: string | null;
  capturedAt: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  priority: number;
  currentStatus: "pending" | "approved" | "flagged" | "deleted";
  divisionName: string | null;
  locationName: string | null;
  campWeekName: string | null;
};

export type QueueFilter    = "all" | "priority" | "recent";
export type QueueSortOrder = "newest_first" | "oldest_first";

export type QueueQuery = {
  page: number;        // 0-indexed
  pageSize: number;    // 25 default at the call site
  filter: QueueFilter;
  queueOrder: QueueSortOrder;
};

type RawQueueRow = {
  id: string;
  smugmug_image_id: string;
  thumbnail_url: string | null;
  smugmug_url: string | null;
  captured_at: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  priority: number;
  current_status: "pending" | "approved" | "flagged" | "deleted";
  camp_weeks: {
    name: string | null;
    locations: {
      name: string | null;
      divisions: { name: string | null } | null;
    } | null;
  } | null;
};

const SELECT =
  "id, smugmug_image_id, thumbnail_url, smugmug_url, captured_at, " +
  "caption, width, height, priority, current_status, " +
  "camp_weeks ( name, locations ( name, divisions ( name ) ) )";

function mapRow(r: RawQueueRow): QueueRow {
  return {
    id:             r.id,
    smugmugImageId: r.smugmug_image_id,
    thumbnailUrl:   r.thumbnail_url,
    smugmugUrl:     r.smugmug_url,
    capturedAt:     r.captured_at,
    caption:        r.caption,
    width:          r.width,
    height:         r.height,
    priority:       r.priority,
    currentStatus:  r.current_status,
    divisionName:   r.camp_weeks?.locations?.divisions?.name ?? null,
    locationName:   r.camp_weeks?.locations?.name ?? null,
    campWeekName:   r.camp_weeks?.name ?? null,
  };
}

// Returns one page of queue rows + the total count for the active filter
// (so the admin UI can render "Showing N–M of T"). Total uses a
// head-only count to avoid pulling rows twice.
export async function fetchQueueList(
  supabase: SupabaseClient,
  q: QueueQuery,
): Promise<{ rows: QueueRow[]; total: number }> {
  const ascending = q.queueOrder === "oldest_first";
  const fromIdx = q.page * q.pageSize;
  const toIdx   = fromIdx + q.pageSize - 1;

  // The "all" filter still excludes terminal-status rows by default —
  // the queue card is about what's currently in the queue, not the full
  // photo history. Terminal photos can be inspected via the queue's
  // direct review-history pages (reviewer-flow surfaces, not this card).
  let query = supabase
    .from("photos")
    .select(SELECT, { count: "exact" })
    .eq("current_status", "pending");

  if (q.filter === "priority") {
    query = query.gt("priority", 0);
  } else if (q.filter === "recent") {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("captured_at", cutoff);
  }

  query = query
    .order("priority",    { ascending: false })
    .order("captured_at", { ascending, nullsFirst: false })
    .range(fromIdx, toIdx);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as RawQueueRow[]).map(mapRow);
  return { rows, total: count ?? 0 };
}

// Lightweight "are there ANY pending photos with no review?" check, used
// by the Edit-config modal to decide whether to surface the mode-switch
// keep/clear dialog. Exact count not needed — we only branch on > 0.
export async function fetchPendingWithoutReviewCount(
  supabase: SupabaseClient,
): Promise<number> {
  // The "without review" qualifier matters: a photo with at least one
  // review row is preserved by the clear-pending endpoint, so it
  // shouldn't trip the "you'll lose work" warning.
  //
  // Two-step approach: count pending photos, then count pending photos
  // that DO have reviews, subtract. PostgREST doesn't easily support
  // "left join + null filter" via the JS client, so this is the cleanest
  // round-trip-bounded option.
  const { count: pending, error: pendingErr } = await supabase
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("current_status", "pending");
  if (pendingErr) throw pendingErr;

  // Distinct pending photo_ids that appear in reviews. We pull the ids
  // and de-dupe client-side; in practice a pending photo has 0 reviews
  // (status would have flipped to flagged/approved/deleted), but we
  // honor the immutable-log contract just in case.
  const { data: reviewedPending, error: reviewedErr } = await supabase
    .from("reviews")
    .select("photo_id, photos!inner ( current_status )")
    .eq("photos.current_status", "pending");
  if (reviewedErr) throw reviewedErr;

  const reviewed = new Set(
    ((reviewedPending ?? []) as unknown as { photo_id: string }[]).map((r) => r.photo_id),
  );

  const total = pending ?? 0;
  return Math.max(0, total - reviewed.size);
}
