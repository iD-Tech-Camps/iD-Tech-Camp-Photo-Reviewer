import type { SupabaseClient } from "@supabase/supabase-js";

// Append-only audit trail of SmugMug sync runs (migration 21, step 8.2).
// Read by the Admin → SmugMug sync-log card (8.5). Writes flow through the
// service-role sync handlers (8.4 + 8.5 endpoints), which bypass RLS;
// reads here go through the `sync_log_select_admin` policy that gates
// non-admins out at the database layer.
export type SyncKind   = "scheduled" | "manual" | "quarantine_move" | "triage_sample";
export type SyncStatus = "success"   | "partial" | "failed";

export type SyncLogRow = {
  id: string;
  startedAt: string;
  // NULL while the run is in flight; the 8.4 finalize step sets it on
  // completion. The admin table renders an "in flight" badge for nulls.
  finishedAt: string | null;
  kind: SyncKind;
  status: SyncStatus;
  weeksInScope: number | null;
  imagesSeen: number | null;
  photosAdded: number;
  photosUpdated: number;
  photosRemoved: number;
  errorSummary: string | null;
  triggeredBy: string | null;
  // Joined from profiles for the table column. Cron rows leave this
  // null and the UI renders "Cron" in that case.
  triggeredByName: string | null;
  triggeredByEmail: string | null;
};

type RawSyncLogRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  kind: SyncKind;
  status: SyncStatus;
  weeks_in_scope: number | null;
  images_seen: number | null;
  photos_added: number;
  photos_updated: number;
  photos_removed: number;
  error_summary: string | null;
  triggered_by: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

const COLUMNS =
  "id, started_at, finished_at, kind, status, weeks_in_scope, images_seen, " +
  "photos_added, photos_updated, photos_removed, error_summary, triggered_by, " +
  "profiles ( full_name, email )";

function mapRow(r: RawSyncLogRow): SyncLogRow {
  return {
    id:               r.id,
    startedAt:        r.started_at,
    finishedAt:       r.finished_at,
    kind:             r.kind,
    status:           r.status,
    weeksInScope:     r.weeks_in_scope,
    imagesSeen:       r.images_seen,
    photosAdded:      Number(r.photos_added ?? 0),
    photosUpdated:    Number(r.photos_updated ?? 0),
    photosRemoved:    Number(r.photos_removed ?? 0),
    errorSummary:     r.error_summary,
    triggeredBy:      r.triggered_by,
    triggeredByName:  r.profiles?.full_name ?? null,
    triggeredByEmail: r.profiles?.email     ?? null,
  };
}

// Pulls the most recent N sync_log rows for the admin table. Embeds the
// triggering admin's profile (left join — cron rows leave triggered_by
// NULL and we still want to see them).
export async function fetchRecentSyncLog(
  supabase: SupabaseClient,
  limit = 20,
): Promise<SyncLogRow[]> {
  const { data, error } = await supabase
    .from("sync_log")
    .select(COLUMNS)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as RawSyncLogRow[]).map(mapRow);
}

/** Human-readable delta + scope line for the admin sync-log table. */
export type LatestSyncSummary = {
  startedAt: string;
  finishedAt: string | null;
  status: SyncStatus;
  kind: SyncKind;
  summaryLine: string;
};

/** Most recent sync_log row for the Photo sync header (replaces smugmug_config.last_sync_*). */
export async function fetchLatestSyncSummary(
  supabase: SupabaseClient,
): Promise<LatestSyncSummary | null> {
  const rows = await fetchRecentSyncLog(supabase, 1);
  const row = rows[0];
  if (!row) return null;

  const counts = formatSyncLogCounts(row);
  const summaryLine = row.finishedAt === null
    ? "in flight"
    : `${row.status} · ${counts}`;

  return {
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    kind: row.kind,
    summaryLine,
  };
}

export function formatSyncLogCounts(row: Pick<
  SyncLogRow,
  "kind" | "weeksInScope" | "imagesSeen" | "photosAdded" | "photosUpdated" | "photosRemoved"
>): string {
  const delta = `+${row.photosAdded} ~${row.photosUpdated} -${row.photosRemoved}`;
  if (row.kind !== "scheduled" && row.kind !== "manual") return delta;
  if (row.weeksInScope == null && row.imagesSeen == null) return delta;
  const scope =
    row.weeksInScope != null && row.imagesSeen != null
      ? `${row.weeksInScope} wk · ${row.imagesSeen} img`
      : row.weeksInScope != null
        ? `${row.weeksInScope} wk`
        : `${row.imagesSeen} img`;
  return `${scope} · ${delta}`;
}
