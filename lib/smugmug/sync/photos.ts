import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAlbumImages } from "../albums";
import { getAlbumKeyForNode } from "../nodes";
import type { SmugMugImage } from "../types";
import { mapWithConcurrency } from "./concurrency";

/**
 * Step 8.4 — photo enumeration + scheduled sync core.
 *
 * `runPhotoSync` is the single entry point used by both the manual
 * `/api/smugmug/sync-now` route (admin-gated) and the scheduled
 * `/api/smugmug/sync-scheduled` route (Vercel Cron + CRON_SECRET). It
 * walks every in-scope camp week under a `synced=true` division,
 * enumerates each album's images via the SmugMug API, and reconciles
 * them into `public.photos` according to spec/TRIAGE_SPEC.md §0:
 *
 *  - Photos already in the table are matched by `smugmug_image_id` and
 *    updated in place when fields drift; never re-inserted.
 *  - Photos missing from SmugMug are DELETE'd unless preserved: any row
 *    with triage history (`triage_events`) or `triage_state` other than
 *    `not_required` stays in the DB.
 *  - Removed row count drives `sync_log.photos_removed`.
 *  - Re-parented photos (same `smugmug_image_id`, different parent
 *    folder on SmugMug) get their `camp_week_id` updated.
 *
 * Scope resolution:
 *  - `summer` mode: weeks where `starts_on >= smugmug_config.season_start_date`.
 *  - `off_season` mode: weeks where `starts_on >= smugmug_config.earliest_fetch_date`.
 *  - In both modes, the week's division must have `synced = true`.
 *
 * The Supabase client passed in MUST be a service-role client — every
 * write target (`photos`, `sync_log`, `smugmug_config`) is RLS-locked
 * against authenticated-role writes.
 */

// Bounded fan-out so a sync with 150+ in-scope weeks doesn't fire 150+
// concurrent SmugMug album-image pagination loops. Matches the existing
// 8.3 walker's posture (5 + 5 = 25 max in flight under the deep walk).
const WEEK_CONCURRENCY = 5;

export interface PhotoSyncOptions {
  kind: "scheduled" | "manual";
  /** Profile id of the admin who triggered a manual sync; null for cron. */
  triggeredBy: string | null;
}

export interface PhotoSyncScope {
  mode: "summer" | "off_season";
  cutoffDate: string;
  weekCount: number;
}

export interface PhotoSyncResult {
  syncLogId: string | null;
  status: "success" | "partial" | "failed";
  scope: PhotoSyncScope | null;
  photosAdded: number;
  photosUpdated: number;
  photosRemoved: number;
  errorSummary: string | null;
  perWeekErrors: Array<{ campWeekId: string; smugmugFolderId: string; message: string }>;
}

interface SmugmugConfigRow {
  mode: "summer" | "off_season";
  season_start_date: string | null;
  earliest_fetch_date: string | null;
}

interface CampWeekRow {
  id: string;
  smugmug_folder_id: string;
  location_id: string;
  location_name: string;
  division_id: string;
  division_name: string;
}

interface PhotoRow {
  id: string;
  camp_week_id: string;
  smugmug_image_id: string;
  triage_state: string;
  caption: string | null;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  image_url: string | null;
  thumbnail_url: string | null;
  smugmug_url: string | null;
  smugmug_folder_id: string | null;
}

interface MappedPhotoFields {
  caption: string | null;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  image_url: string | null;
  thumbnail_url: string | null;
  smugmug_url: string | null;
  smugmug_folder_id: string | null;
}

interface MappedPhoto extends MappedPhotoFields {
  smugmug_image_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runPhotoSync(
  supabase: SupabaseClient,
  opts: PhotoSyncOptions
): Promise<PhotoSyncResult> {
  // 1. Insert in-flight sync_log row up front so a hard failure mid-run
  //    still leaves a trail. Status starts as 'success'; we update it
  //    to the real terminal state at the end.
  const syncLogId = await insertSyncLogRow(supabase, opts);

  let status: "success" | "partial" | "failed" = "success";
  let scope: PhotoSyncScope | null = null;
  let photosAdded = 0;
  let photosUpdated = 0;
  let photosRemoved = 0;
  let errorSummary: string | null = null;
  const perWeekErrors: PhotoSyncResult["perWeekErrors"] = [];

  try {
    // 2. Read config + compute the date cutoff.
    const config = await fetchConfig(supabase);
    const cutoffDate = resolveCutoff(config);

    // 3. Resolve in-scope weeks.
    const weeks = await fetchInScopeWeeks(supabase, cutoffDate);
    scope = { mode: config.mode, cutoffDate, weekCount: weeks.length };

    // 4. Walk + reconcile each week, bounded in-flight.
    const perWeekResults = await mapWithConcurrency(
      weeks,
      WEEK_CONCURRENCY,
      async (week) => {
        try {
          return await syncOneWeek(supabase, week);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          perWeekErrors.push({
            campWeekId: week.id,
            smugmugFolderId: week.smugmug_folder_id,
            message,
          });
          return { added: 0, updated: 0, removed: 0 };
        }
      }
    );

    for (const r of perWeekResults) {
      photosAdded += r.added;
      photosUpdated += r.updated;
      photosRemoved += r.removed;
    }

    if (perWeekErrors.length > 0) {
      status = "partial";
      errorSummary =
        `${perWeekErrors.length} week(s) failed; first error: ${perWeekErrors[0].message}`;
    }
  } catch (err) {
    status = "failed";
    errorSummary = err instanceof Error ? err.message : String(err);
  }

  // 5. Update sync_log + smugmug_config with the terminal state.
  await finalizeSyncLog(supabase, syncLogId, {
    status,
    photos_added: photosAdded,
    photos_updated: photosUpdated,
    photos_removed: photosRemoved,
    error_summary: errorSummary,
  });
  await updateConfigSummary(supabase, status, photosAdded, photosUpdated, photosRemoved, errorSummary);

  return {
    syncLogId,
    status,
    scope,
    photosAdded,
    photosUpdated,
    photosRemoved,
    errorSummary,
    perWeekErrors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// sync_log lifecycle
// ─────────────────────────────────────────────────────────────────────────────

async function insertSyncLogRow(
  supabase: SupabaseClient,
  opts: PhotoSyncOptions
): Promise<string> {
  const { data, error } = await supabase
    .from("sync_log")
    .insert({
      kind: opts.kind,
      // Placeholder terminal state; finalizeSyncLog overwrites this when
      // the run wraps. Inserting with a real enum value (rather than NULL)
      // keeps the column NOT NULL contract intact for the small window
      // between insert and finalize.
      status: "success",
      triggered_by: opts.triggeredBy,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`sync_log insert failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id as string;
}

async function finalizeSyncLog(
  supabase: SupabaseClient,
  id: string,
  patch: {
    status: "success" | "partial" | "failed";
    photos_added: number;
    photos_updated: number;
    photos_removed: number;
    error_summary: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("sync_log")
    .update({
      finished_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", id);
  if (error) {
    // Don't throw — the caller already has the result and the sync
    // succeeded; failing to finalize the audit row is bad but not worth
    // surfacing as a top-level run failure.
    console.error("[runPhotoSync] sync_log finalize failed:", error);
  }
}

async function updateConfigSummary(
  supabase: SupabaseClient,
  status: "success" | "partial" | "failed",
  added: number,
  updated: number,
  removed: number,
  errorSummary: string | null
): Promise<void> {
  const summary =
    status === "failed"
      ? `failed · ${errorSummary ?? "unknown error"}`
      : `${status} · +${added} ~${updated} -${removed}`;
  const { error } = await supabase
    .from("smugmug_config")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) {
    console.error("[runPhotoSync] smugmug_config summary update failed:", error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope resolution
// ─────────────────────────────────────────────────────────────────────────────

async function fetchConfig(supabase: SupabaseClient): Promise<SmugmugConfigRow> {
  const { data, error } = await supabase
    .from("smugmug_config")
    .select("mode, season_start_date, earliest_fetch_date")
    .eq("id", 1)
    .single();
  if (error || !data) {
    throw new Error(`smugmug_config read failed: ${error?.message ?? "no row"}`);
  }
  return data as SmugmugConfigRow;
}

function resolveCutoff(config: SmugmugConfigRow): string {
  if (config.mode === "summer") {
    if (!config.season_start_date) {
      throw new Error(
        "smugmug_config.season_start_date is NULL but mode=summer; set it before syncing."
      );
    }
    return config.season_start_date;
  }
  if (!config.earliest_fetch_date) {
    throw new Error(
      "smugmug_config.earliest_fetch_date is NULL but mode=off_season; set it before syncing."
    );
  }
  return config.earliest_fetch_date;
}

async function fetchInScopeWeeks(
  supabase: SupabaseClient,
  cutoffDate: string
): Promise<CampWeekRow[]> {
  // Paginated select to dodge PostgREST's 1000-row default response cap;
  // a single division can easily run thousands of camp_weeks rows once
  // the historical synced-true subtree lands.
  const pageSize = 1000;
  const out: CampWeekRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("camp_weeks")
      .select(
        "id, smugmug_folder_id, location_id, " +
          "locations!inner ( id, name, division_id, divisions!inner ( id, name, synced ) )"
      )
      .gte("starts_on", cutoffDate)
      .eq("locations.divisions.synced", true)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`camp_weeks scope query failed: ${error.message}`);
    type Raw = {
      id: string;
      smugmug_folder_id: string;
      location_id: string;
      locations: {
        id: string;
        name: string;
        division_id: string;
        divisions: { id: string; name: string; synced: boolean } | null;
      } | null;
    };
    const rows = (data ?? []) as unknown as Raw[];
    for (const r of rows) {
      const loc = r.locations;
      const div = loc?.divisions;
      if (!loc || !div) continue;
      out.push({
        id: r.id,
        smugmug_folder_id: r.smugmug_folder_id,
        location_id: r.location_id,
        location_name: loc.name,
        division_id: loc.division_id,
        division_name: div.name,
      });
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-week walk + reconcile
// ─────────────────────────────────────────────────────────────────────────────

async function syncOneWeek(
  supabase: SupabaseClient,
  week: CampWeekRow
): Promise<{ added: number; updated: number; removed: number }> {
  // Resolve the album key for this week's SmugMug folder. Skip cleanly
  // if the node isn't actually an Album (e.g. someone synced a folder
  // that hasn't been turned into an album yet) — non-fatal; reconcile
  // will simply find no walked images and treat all existing rows as
  // "still missing", but only DELETE the unreviewed ones, which is the
  // documented contract.
  const albumKey = await getAlbumKeyForNode(week.smugmug_folder_id);

  const walked: MappedPhoto[] = [];
  if (albumKey) {
    for await (const img of listAlbumImages(albumKey)) {
      // Skip videos for now — the photo reviewer is photos-only.
      if (img.IsVideo) continue;
      walked.push(mapImage(img, week.smugmug_folder_id));
    }
  }

  // Existing photos under this week (small per-week working set).
  const existing = await fetchExistingForWeek(supabase, week.id);
  const existingByKey = new Map<string, PhotoRow>();
  for (const p of existing) existingByKey.set(p.smugmug_image_id, p);

  // Cross-week match: photos sitting under a different camp_week_id
  // whose smugmug_image_id appears in this week's walk. That's a
  // re-parented photo — SmugMug moved it between week albums.
  const walkedKeys = walked.map((w) => w.smugmug_image_id);
  const reparents = await fetchPhotosByKeysExcludingWeek(
    supabase,
    walkedKeys,
    week.id
  );
  const reparentByKey = new Map<string, PhotoRow>();
  for (const p of reparents) reparentByKey.set(p.smugmug_image_id, p);

  let added = 0;
  let updated = 0;

  // 1. Walk the freshly-listed images, upsert each.
  for (const w of walked) {
    const sameWeek = existingByKey.get(w.smugmug_image_id);
    if (sameWeek) {
      const drift = computeDrift(sameWeek, w);
      if (drift) {
        await updatePhotoRow(supabase, sameWeek.id, drift);
        updated += 1;
      }
      continue;
    }

    const moved = reparentByKey.get(w.smugmug_image_id);
    if (moved) {
      await updatePhotoRow(supabase, moved.id, {
        camp_week_id: week.id,
        ...mappedFields(w),
      });
      updated += 1;
      continue;
    }

    await insertPhotoRow(supabase, week.id, w);
    added += 1;
  }

  // 2. Existing rows in this week that the walk didn't see — delete only
  //    when triage has not touched them (TRIAGE_SPEC §0).
  const walkedKeySet = new Set(walkedKeys);
  const orphanIds = existing
    .filter((p) => !walkedKeySet.has(p.smugmug_image_id))
    .map((p) => p.id);
  let removed = 0;
  if (orphanIds.length > 0) {
    const protectedIds = await fetchProtectedOrphanIds(supabase, orphanIds);
    const deletableIds = orphanIds.filter((id) => !protectedIds.has(id));
    if (deletableIds.length > 0) {
      const { error } = await supabase.from("photos").delete().in("id", deletableIds);
      if (error) throw new Error(`photos delete failed: ${error.message}`);
      removed = deletableIds.length;
    }
  }

  return { added, updated, removed };
}

async function fetchExistingForWeek(
  supabase: SupabaseClient,
  campWeekId: string
): Promise<PhotoRow[]> {
  const pageSize = 1000;
  const out: PhotoRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("photos")
      .select(
        "id, camp_week_id, smugmug_image_id, triage_state, caption, captured_at, " +
          "width, height, image_url, thumbnail_url, smugmug_url, smugmug_folder_id"
      )
      .eq("camp_week_id", campWeekId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`photos read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as PhotoRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// PostgREST's `.in("col", arr)` builds a `?col=in.(...)` query string and
// crowds out the URL when arr is large. SmugMug album sizes can hit a
// few thousand images per week, so chunk the lookup.
const KEY_BATCH_SIZE = 200;
const ORPHAN_BATCH_SIZE = 200;

/** Orphans with triage_events or triage_state <> not_required must not be deleted. */
async function fetchProtectedOrphanIds(
  supabase: SupabaseClient,
  orphanIds: string[]
): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  if (orphanIds.length === 0) return protectedIds;

  for (let i = 0; i < orphanIds.length; i += ORPHAN_BATCH_SIZE) {
    const batch = orphanIds.slice(i, i + ORPHAN_BATCH_SIZE);

    const { data: stateRows, error: stateErr } = await supabase
      .from("photos")
      .select("id")
      .in("id", batch)
      .neq("triage_state", "not_required");
    if (stateErr) {
      throw new Error(`photos triage_state read failed: ${stateErr.message}`);
    }
    for (const row of stateRows ?? []) {
      protectedIds.add((row as { id: string }).id);
    }

    const { data: eventRows, error: eventErr } = await supabase
      .from("triage_events")
      .select("photo_id")
      .in("photo_id", batch);
    if (eventErr) {
      throw new Error(`triage_events read failed: ${eventErr.message}`);
    }
    for (const row of eventRows ?? []) {
      protectedIds.add((row as { photo_id: string }).photo_id);
    }
  }

  return protectedIds;
}

async function fetchPhotosByKeysExcludingWeek(
  supabase: SupabaseClient,
  keys: string[],
  excludeCampWeekId: string
): Promise<PhotoRow[]> {
  if (keys.length === 0) return [];
  const out: PhotoRow[] = [];
  for (let i = 0; i < keys.length; i += KEY_BATCH_SIZE) {
    const batch = keys.slice(i, i + KEY_BATCH_SIZE);
    const { data, error } = await supabase
      .from("photos")
      .select(
        "id, camp_week_id, smugmug_image_id, triage_state, caption, captured_at, " +
          "width, height, image_url, thumbnail_url, smugmug_url, smugmug_folder_id"
      )
      .in("smugmug_image_id", batch)
      .neq("camp_week_id", excludeCampWeekId);
    if (error) throw new Error(`photos cross-week read failed: ${error.message}`);
    out.push(...((data ?? []) as unknown as PhotoRow[]));
  }
  return out;
}

async function insertPhotoRow(
  supabase: SupabaseClient,
  campWeekId: string,
  photo: MappedPhoto
): Promise<void> {
  const { error } = await supabase.from("photos").insert({
    camp_week_id: campWeekId,
    smugmug_image_id: photo.smugmug_image_id,
    ...mappedFields(photo),
  });
  if (error) throw new Error(`photos insert failed: ${error.message}`);
}

async function updatePhotoRow(
  supabase: SupabaseClient,
  photoId: string,
  patch: Partial<{ camp_week_id: string }> & Partial<MappedPhotoFields>
): Promise<void> {
  const { error } = await supabase
    .from("photos")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", photoId);
  if (error) throw new Error(`photos update failed: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping + drift detection
// ─────────────────────────────────────────────────────────────────────────────

function mapImage(img: SmugMugImage, weekFolderId: string): MappedPhoto {
  return {
    smugmug_image_id: img.ImageKey,
    caption: img.Caption ?? img.Title ?? null,
    // Use DateTimeUploaded as the canonical timestamp. EXIF
    // DateTimeOriginal is unreliable on the iD Tech account — many
    // images lack EXIF and SmugMug substitutes a Y2K placeholder
    // (~2001-01-01) that pollutes ordering and review-side displays.
    // `Date` is a fallback for legacy responses that omit the explicit
    // upload field.
    captured_at: parseDateOrNull(img.DateTimeUploaded ?? img.Date),
    width: typeof img.Width === "number" ? img.Width : null,
    height: typeof img.Height === "number" ? img.Height : null,
    // ArchivedUri is the highest-fidelity URL the basic Image payload
    // exposes without a follow-up !sizes call. Step 8.6 may revise this
    // once the renderer settles on a target size.
    image_url: img.ArchivedUri ?? img.ThumbnailUrl ?? null,
    thumbnail_url: img.ThumbnailUrl ?? null,
    smugmug_url: img.WebUri ?? null,
    smugmug_folder_id: weekFolderId,
  };
}

function mappedFields(p: MappedPhoto): MappedPhotoFields {
  return {
    caption: p.caption,
    captured_at: p.captured_at,
    width: p.width,
    height: p.height,
    image_url: p.image_url,
    thumbnail_url: p.thumbnail_url,
    smugmug_url: p.smugmug_url,
    smugmug_folder_id: p.smugmug_folder_id,
  };
}

function computeDrift(existing: PhotoRow, walked: MappedPhoto): MappedPhotoFields | null {
  const next = mappedFields(walked);
  // Compare timestamps as their parsed numeric value, since DB-format
  // (e.g. "2025-07-28T14:32:01+00:00") and our toISOString output
  // ("2025-07-28T14:32:01.000Z") may differ by representation while
  // referring to the same instant. Anything else is a string compare.
  const tsExisting = existing.captured_at ? Date.parse(existing.captured_at) : NaN;
  const tsNext = next.captured_at ? Date.parse(next.captured_at) : NaN;
  const tsSame =
    (existing.captured_at == null && next.captured_at == null) ||
    (Number.isFinite(tsExisting) && Number.isFinite(tsNext) && tsExisting === tsNext);

  const fieldsEqual =
    existing.caption === next.caption &&
    tsSame &&
    existing.width === next.width &&
    existing.height === next.height &&
    existing.image_url === next.image_url &&
    existing.thumbnail_url === next.thumbnail_url &&
    existing.smugmug_url === next.smugmug_url &&
    existing.smugmug_folder_id === next.smugmug_folder_id;

  return fieldsEqual ? null : next;
}

function parseDateOrNull(s: string | undefined | null): string | null {
  if (!s) return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}
