import type { SupabaseClient } from "@supabase/supabase-js";

// Append-only audit trail of SmugMug sync runs (migration 21, step 8.2).
// Read by the Admin → SmugMug sync-log card (8.5). Writes flow through the
// service-role sync handlers (8.4 + 8.5 endpoints), which bypass RLS;
// reads here go through the `sync_log_select_admin` policy that gates
// non-admins out at the database layer.
export type SyncKind   = "scheduled" | "manual" | "mode_switch" | "priority_add" | "quarantine_move";
export type SyncStatus = "success"   | "partial" | "failed";

export type SyncLogRow = {
  id: string;
  startedAt: string;
  // NULL while the run is in flight; the 8.4 finalize step sets it on
  // completion. The admin table renders an "in flight" badge for nulls.
  finishedAt: string | null;
  kind: SyncKind;
  status: SyncStatus;
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
  photos_added: number;
  photos_updated: number;
  photos_removed: number;
  error_summary: string | null;
  triggered_by: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

const COLUMNS =
  "id, started_at, finished_at, kind, status, photos_added, photos_updated, " +
  "photos_removed, error_summary, triggered_by, profiles ( full_name, email )";

function mapRow(r: RawSyncLogRow): SyncLogRow {
  return {
    id:               r.id,
    startedAt:        r.started_at,
    finishedAt:       r.finished_at,
    kind:             r.kind,
    status:           r.status,
    photosAdded:      r.photos_added,
    photosUpdated:    r.photos_updated,
    photosRemoved:    r.photos_removed,
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
