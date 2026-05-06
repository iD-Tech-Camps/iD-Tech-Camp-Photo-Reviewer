import type { SupabaseClient } from "@supabase/supabase-js";

// Camel-cased projection of the `reviewer_stats` view (see migration 15).
// One row per profile, joined to aggregated `reviews` counts/sums. Used by
// both the Profile screen (single reviewer) and the Admin Overview roster
// (every reviewer).
export type ReviewerStats = {
  id: string;
  email: string;
  fullName: string | null;
  role: "reviewer" | "senior" | "admin";
  team: string | null;
  status: "active" | "idle" | "inactive";
  createdAt: string;
  lastActiveAt: string;
  totalReviews: number;
  approves: number;
  flags: number;
  deletes: number;
  totalPoints: number;
  lastReviewedAt: string | null;
  reviewedToday: number;
};

type RawReviewerStatsRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: "reviewer" | "senior" | "admin";
  team: string | null;
  status: "active" | "idle" | "inactive";
  created_at: string;
  last_active_at: string;
  total_reviews: number;
  approves: number;
  flags: number;
  deletes: number;
  total_points: number;
  last_reviewed_at: string | null;
  reviewed_today: number;
};

const STATS_COLUMNS =
  "id, email, full_name, role, team, status, created_at, last_active_at, " +
  "total_reviews, approves, flags, deletes, total_points, last_reviewed_at, reviewed_today";

function mapRow(r: RawReviewerStatsRow): ReviewerStats {
  return {
    id:             r.id,
    email:          r.email,
    fullName:       r.full_name,
    role:           r.role,
    team:           r.team,
    status:         r.status,
    createdAt:      r.created_at,
    lastActiveAt:   r.last_active_at,
    totalReviews:   r.total_reviews,
    approves:       r.approves,
    flags:          r.flags,
    deletes:        r.deletes,
    totalPoints:    r.total_points,
    lastReviewedAt: r.last_reviewed_at,
    reviewedToday:  r.reviewed_today,
  };
}

// Fetch the stats row for a single profile. Returns null if no row matches —
// e.g. a brand-new account whose `handle_new_user` trigger hasn't run yet
// (which would be a server-side anomaly, not a normal client state).
export async function fetchMyStats(
  supabase: SupabaseClient,
  profileId: string,
): Promise<ReviewerStats | null> {
  const { data, error } = await supabase
    .from("reviewer_stats")
    .select(STATS_COLUMNS)
    .eq("id", profileId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as RawReviewerStatsRow);
}

// Fetch every profile's stats for the Admin Overview roster. Ordered by
// `total_points desc` so the most active reviewers float to the top — same
// implicit ranking the mock `ADMIN_USERS` array used.
export async function fetchReviewerRoster(
  supabase: SupabaseClient,
): Promise<ReviewerStats[]> {
  const { data, error } = await supabase
    .from("reviewer_stats")
    .select(STATS_COLUMNS)
    .order("total_points", { ascending: false })
    .order("full_name",    { ascending: true,  nullsFirst: false });

  if (error) throw error;
  return ((data ?? []) as unknown as RawReviewerStatsRow[]).map(mapRow);
}

// ─── admin write helpers ────────────────────────────────────────────────────
// Updates target the `profiles` base table directly (the `reviewer_stats`
// view is read-only — it joins aggregates). Goes through the
// `profiles_update_admin` RLS policy from migration 9, which allows admins
// to update any profile's `role` and `team`.

export type UpdateReviewerProfileInput = {
  role?: "reviewer" | "senior" | "admin";
  team?: string | null;
};

export async function updateReviewerProfile(
  supabase: SupabaseClient,
  profileId: string,
  patch: UpdateReviewerProfileInput,
): Promise<void> {
  const rowPatch: Record<string, unknown> = {};
  if (patch.role !== undefined) rowPatch.role = patch.role;
  // Empty/whitespace team collapses to null so the "—" placeholder renders
  // consistently in the roster table.
  if (patch.team !== undefined) {
    const trimmed = (patch.team ?? "").trim();
    rowPatch.team = trimmed.length === 0 ? null : trimmed;
  }
  if (Object.keys(rowPatch).length === 0) return;

  const { error } = await supabase
    .from("profiles")
    .update(rowPatch)
    .eq("id", profileId);
  if (error) throw error;
}
