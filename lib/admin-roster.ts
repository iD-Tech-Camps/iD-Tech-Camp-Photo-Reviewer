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

function mapRow(r: RawProfileRow): RosterRow {
  return {
    id:           r.id,
    email:        r.email,
    fullName:     r.full_name,
    role:         r.role,
    team:         r.team,
    createdAt:    r.created_at,
    lastActiveAt: r.last_active_at,
  };
}

// Pulls every profile row; ordered most-recently-active first so admins
// see live accounts at the top of the table.
export async function fetchAdminRoster(
  supabase: SupabaseClient,
): Promise<RosterRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(COLUMNS)
    .order("last_active_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as RawProfileRow[]).map(mapRow);
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
