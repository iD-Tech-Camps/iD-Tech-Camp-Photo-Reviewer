import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/current-user";

// Minimal roster + reviewer-edit helpers for Admin → Overview:
// identity + role + team + last-active. Per-user activity counts will
// land here when the rating system is rebuilt.

export type RosterRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  team: string | null;
  createdAt: string;
  lastActiveAt: string;
  totalPoints: number;
  eventCount: number;
};

type RawProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  team: string | null;
  created_at: string;
  last_active_at: string;
};

const COLUMNS =
  "id, email, full_name, role, team, created_at, last_active_at";

function mapRow(
  r: RawProfileRow,
  totals: Map<string, { totalPoints: number; eventCount: number }>,
): RosterRow {
  const t = totals.get(r.id);
  return {
    id:           r.id,
    email:        r.email,
    fullName:     r.full_name,
    role:         r.role,
    team:         r.team,
    createdAt:    r.created_at,
    lastActiveAt: r.last_active_at,
    totalPoints:  t?.totalPoints ?? 0,
    eventCount:   t?.eventCount ?? 0,
  };
}

type RawTotalRow = { user_id: string; total_points: number; event_count: number };

// Pulls every profile row; ordered most-recently-active first so admins
// see live accounts at the top of the table. Per-user points totals come
// from the user_points_totals view (RLS lets admins read all rows); a
// reviewer with zero events has no row, which we render as "0 pts".
export async function fetchAdminRoster(
  supabase: SupabaseClient,
): Promise<RosterRow[]> {
  const [{ data, error }, { data: totalsData, error: totalsErr }] = await Promise.all([
    supabase.from("profiles").select(COLUMNS).order("last_active_at", { ascending: false }),
    supabase.from("user_points_totals").select("user_id, total_points, event_count"),
  ]);
  if (error) throw error;
  if (totalsErr) throw totalsErr;

  const totalsMap = new Map<string, { totalPoints: number; eventCount: number }>();
  for (const row of (totalsData ?? []) as unknown as RawTotalRow[]) {
    totalsMap.set(row.user_id, { totalPoints: row.total_points, eventCount: row.event_count });
  }

  return ((data ?? []) as unknown as RawProfileRow[]).map((r) => mapRow(r, totalsMap));
}

// Admin-only role/team update. RLS policy `profiles_update_admin`
// (migration 9) gates the write — non-admins get rejected at the DB
// layer. Team coerces to NULL on empty/whitespace so the column doesn't
// accumulate "".
export async function updateReviewerProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: { role: Role; team: string },
): Promise<void> {
  const trimmedTeam = patch.team.trim();
  const { error } = await supabase
    .from("profiles")
    .update({
      role: patch.role,
      team: trimmedTeam.length === 0 ? null : trimmedTeam,
    })
    .eq("id", userId);
  if (error) throw error;
}
