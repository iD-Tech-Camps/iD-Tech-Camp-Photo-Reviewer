import type { SupabaseClient } from "@supabase/supabase-js";

// Single-row SmugMug ingestion configuration (migration 21, step 8.2).
// Read by the 8.4 photo-sync core to decide which camp_weeks are
// in-scope; written by the Admin → SmugMug screen. Same singleton
// pattern as app_settings: id is always 1.
//
// `mode` + the `smugmug_mode` enum are kept post-refactor as a placeholder
// for the future quality-review spec — no current code consumes the
// distinction (the sync handlers always pick a date column directly),
// but they survive so the future spec doesn't have to recreate them.
// `queue_order` was dropped in migration 26 (reviewer queue is gone;
// triage iterates camp_weeks, not photos).
export type SmugmugMode = "summer" | "off_season";

export type SmugmugConfig = {
  mode: SmugmugMode;
  // Lower bound for `camp_weeks.starts_on` in summer mode (admin pins
  // this to the first day of camp for the season); irrelevant in
  // off-season mode but kept around so a mode flip back to summer can
  // pick up where it left off without re-entering the date.
  seasonStartDate: string | null;
  // Lower bound for `camp_weeks.starts_on` in off-season mode (admin
  // sets this when working through archival cleanup between summers).
  earliestFetchDate: string | null;
  // Mirrored from the most recent successful sync_log row by the 8.4
  // sync handlers — exposed here so the settings card can render the
  // last-sync line without joining sync_log.
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  updatedAt: string;
};

type RawSmugmugConfigRow = {
  mode: SmugmugMode;
  season_start_date: string | null;
  earliest_fetch_date: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  updated_at: string;
};

const COLUMNS =
  "mode, season_start_date, earliest_fetch_date, " +
  "last_sync_at, last_sync_status, updated_at";

function mapRow(r: RawSmugmugConfigRow): SmugmugConfig {
  return {
    mode:               r.mode,
    seasonStartDate:    r.season_start_date,
    earliestFetchDate:  r.earliest_fetch_date,
    lastSyncAt:         r.last_sync_at,
    lastSyncStatus:     r.last_sync_status,
    updatedAt:          r.updated_at,
  };
}

// Returns null only on a fresh DB where the singleton row was never
// seeded. Migration 21 seeds it, so production never hits this branch;
// callers should still treat null as a soft failure rather than crashing.
export async function fetchSmugmugConfig(
  supabase: SupabaseClient,
): Promise<SmugmugConfig | null> {
  const { data, error } = await supabase
    .from("smugmug_config")
    .select(COLUMNS)
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as RawSmugmugConfigRow);
}

// Admin-only write through `smugmug_config_write_admin` (migration 21).
// Only the keys present on `patch` are forwarded — partial updates so the
// edit modal doesn't have to send back columns it didn't touch.
//
// `lastSyncAt` / `lastSyncStatus` are intentionally NOT exposed on the
// patch surface even though they're in the SmugmugConfig type — those
// columns are owned by the 8.4 sync handlers writing under the service
// role, not by the admin UI.
export async function updateSmugmugConfig(
  supabase: SupabaseClient,
  patch: Partial<Pick<
    SmugmugConfig,
    "mode" | "seasonStartDate" | "earliestFetchDate"
  >>,
): Promise<SmugmugConfig> {
  const rowPatch: Record<string, unknown> = {};
  if (patch.mode               !== undefined) rowPatch.mode                = patch.mode;
  if (patch.seasonStartDate    !== undefined) rowPatch.season_start_date   = patch.seasonStartDate;
  if (patch.earliestFetchDate  !== undefined) rowPatch.earliest_fetch_date = patch.earliestFetchDate;
  rowPatch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("smugmug_config")
    .update(rowPatch)
    .eq("id", 1)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("smugmug_config update returned no row");
  return mapRow(data as unknown as RawSmugmugConfigRow);
}
