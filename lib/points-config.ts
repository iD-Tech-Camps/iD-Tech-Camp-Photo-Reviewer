import type { SupabaseClient } from "@supabase/supabase-js";

// Single-row points configuration (see migration 7). Decisions snapshot
// these values into reviews.points_awarded at insert time so future rate
// changes don't rewrite history.
export type PointsConfig = {
  approvePoints: number;
  flagPoints: number;
  deletePoints: number;
};

type RawPointsConfigRow = {
  approve_points: number;
  flag_points: number;
  delete_points: number;
};

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  approvePoints: 10,
  flagPoints:    15,
  deletePoints:  0,
};

const COLUMNS = "approve_points, flag_points, delete_points";

function mapRow(r: RawPointsConfigRow): PointsConfig {
  return {
    approvePoints: r.approve_points,
    flagPoints:    r.flag_points,
    deletePoints:  r.delete_points,
  };
}

// Returns null only on a fresh DB where the singleton row was never
// seeded. Callers should treat null as "use DEFAULT_POINTS_CONFIG and
// log a warning" — the migration seeds the row, so production never
// hits this branch.
export async function fetchPointsConfig(
  supabase: SupabaseClient,
): Promise<PointsConfig | null> {
  const { data, error } = await supabase
    .from("points_config")
    .select(COLUMNS)
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as RawPointsConfigRow);
}

// Returns the points value for a given decision, given a config (or null
// to fall back to defaults). Centralized so ReviewScreen and any future
// caller compute "base points" the same way.
export function basePointsFor(
  config: PointsConfig | null,
  decision: "approve" | "flag" | "delete",
): number {
  const c = config ?? DEFAULT_POINTS_CONFIG;
  if (decision === "approve") return c.approvePoints;
  if (decision === "flag")    return c.flagPoints;
  return c.deletePoints;
}

// Admin-only write through `points_config_write_admin` RLS (migration 9).
export async function updatePointsConfig(
  supabase: SupabaseClient,
  patch: Partial<PointsConfig>,
): Promise<PointsConfig> {
  const rowPatch: Record<string, unknown> = {};
  if (patch.approvePoints !== undefined) rowPatch.approve_points = patch.approvePoints;
  if (patch.flagPoints    !== undefined) rowPatch.flag_points    = patch.flagPoints;
  if (patch.deletePoints  !== undefined) rowPatch.delete_points  = patch.deletePoints;
  rowPatch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("points_config")
    .update(rowPatch)
    .eq("id", 1)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("points_config update returned no row");
  return mapRow(data as unknown as RawPointsConfigRow);
}
