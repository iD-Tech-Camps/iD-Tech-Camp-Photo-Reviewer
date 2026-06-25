import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalkedDivision, WalkedDivisionDeep } from "./types";

/**
 * Folder-tree reconciliation logic for step 8.3b.
 *
 * Two entry points:
 *   - reconcileTopLevelDivisions(...) — upserts the top-level Folder rows
 *     into public.divisions. Cheap; one SmugMug-walked array in, one set
 *     of DB writes out. Albums at root are filtered (they can't be
 *     divisions). Junk folders (e.g. "TEST - DO NOT USE") still land but
 *     stay synced=false.
 *   - reconcileDivisionDeep(...) — given a deep-walked division, upserts
 *     its locations + camp weeks. Weeks that fail date parsing are
 *     skipped and reported back so the admin can spot naming drift.
 *
 * Both functions match by smugmug_folder_id first, then fall back to
 * (name + parent) to reconcile placeholder rows from migration 13. The
 * fallback updates the existing row's smugmug_folder_id in place rather
 * than inserting a duplicate.
 *
 * The Supabase client passed in MUST be a service-role client — the
 * three target tables (divisions / locations / camp_weeks) reject
 * authenticated-role writes by RLS.
 */

export interface DivisionReconcileResult {
  added: number;
  updatedToReal: number;
  unchanged: number;
  skippedAlbumsAtRoot: number;
}

export interface LocationReconcileResult {
  added: number;
  updatedToReal: number;
  unchanged: number;
}

export interface WeekReconcileResult {
  added: number;
  updatedToReal: number;
  unchanged: number;
  skippedUnparseable: Array<{ name: string; smugmugNodeId: string; locationName: string }>;
  /**
   * Weeks whose SmugMug folder no longer appears in the walk and which had
   * no photos — deleted so they can't keep hijacking the per-location
   * `first_week` role (see `pruneOrphanedWeeks`).
   */
  prunedOrphans: Array<{ name: string; smugmugNodeId: string; locationName: string }>;
  /**
   * Orphaned weeks (folder gone) that still hold photos. Kept — deleting
   * them would violate the photos→camp_weeks ON DELETE RESTRICT FK and
   * could discard reviewed work. Surfaced so an admin can investigate.
   */
  orphansKeptWithPhotos: Array<{ name: string; smugmugNodeId: string; locationName: string }>;
}

export interface DeepReconcileResult {
  divisionName: string;
  locations: LocationReconcileResult;
  weeks: WeekReconcileResult;
}

interface DivisionRow {
  id: string;
  name: string;
  smugmug_folder_id: string;
  synced: boolean;
}

interface LocationRow {
  id: string;
  division_id: string;
  name: string;
  smugmug_folder_id: string;
}

interface CampWeekRow {
  id: string;
  location_id: string;
  name: string;
  smugmug_folder_id: string;
  starts_on: string;
  ends_on: string;
}

// Normalize names before matching so en-dashes / em-dashes / extra
// whitespace don't block placeholder reconciliation. Real iD Tech week
// folders use ASCII hyphens; the placeholder seed used an en-dash, so
// without this the May 25-29, 2026 row would land twice on first apply.
function normalizeName(name: string): string {
  return name.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
}

// PostgREST (Supabase) caps default `select` responses at 1000 rows.
// camp_weeks under a synced division can easily run into the thousands
// (3,772 for iD Tech Camps), so any "fetch existing rows" query that
// could exceed that ceiling has to paginate explicitly. Without this,
// matchById misses for any week past row 1000 and we hit duplicate-key
// errors on what should have been an idempotent re-sync.
async function fetchAllExistingWeeks(
  supabase: SupabaseClient,
  locationIds: string[]
): Promise<CampWeekRow[]> {
  if (locationIds.length === 0) return [];
  const pageSize = 1000;
  const out: CampWeekRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("camp_weeks")
      .select("id, location_id, name, smugmug_folder_id, starts_on, ends_on")
      .in("location_id", locationIds)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data as CampWeekRow[]) ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function reconcileTopLevelDivisions(
  supabase: SupabaseClient,
  walked: WalkedDivision[]
): Promise<DivisionReconcileResult> {
  const folderCandidates = walked.filter((d) => d.type === "Folder");
  const skippedAlbumsAtRoot = walked.length - folderCandidates.length;

  const { data: existing, error } = await supabase
    .from("divisions")
    .select("id, name, smugmug_folder_id, synced");
  if (error) throw error;

  const byId = new Map<string, DivisionRow>();
  const byName = new Map<string, DivisionRow>();
  for (const row of (existing as DivisionRow[]) ?? []) {
    byId.set(row.smugmug_folder_id, row);
    byName.set(normalizeName(row.name), row);
  }

  let added = 0;
  let updatedToReal = 0;
  let unchanged = 0;

  for (const div of folderCandidates) {
    const matchById = byId.get(div.smugmugNodeId);
    if (matchById) {
      // Already synced by ID; only touch if name drifted.
      if (matchById.name !== div.name) {
        const { error: updateError } = await supabase
          .from("divisions")
          .update({ name: div.name })
          .eq("id", matchById.id);
        if (updateError) throw updateError;
      }
      unchanged += 1;
      continue;
    }

    const matchByName = byName.get(normalizeName(div.name));
    if (matchByName?.smugmug_folder_id.startsWith("placeholder-")) {
      // Placeholder reconciliation: swap the placeholder ID for the real one.
      const { error: updateError } = await supabase
        .from("divisions")
        .update({ smugmug_folder_id: div.smugmugNodeId })
        .eq("id", matchByName.id);
      if (updateError) throw updateError;
      updatedToReal += 1;
      continue;
    }

    const { error: insertError } = await supabase
      .from("divisions")
      .insert({ name: div.name, smugmug_folder_id: div.smugmugNodeId, synced: false });
    if (insertError) throw insertError;
    added += 1;
  }

  return { added, updatedToReal, unchanged, skippedAlbumsAtRoot };
}

export async function reconcileDivisionDeep(
  supabase: SupabaseClient,
  walked: WalkedDivisionDeep
): Promise<DeepReconcileResult> {
  // Resolve our DB division row (must exist already — top-level reconcile
  // runs before deep reconcile, so it's there with a real smugmug_folder_id).
  const { data: divRow, error: divErr } = await supabase
    .from("divisions")
    .select("id, name, smugmug_folder_id, synced")
    .eq("smugmug_folder_id", walked.smugmugNodeId)
    .single();
  if (divErr || !divRow) {
    throw new Error(
      `Division ${walked.name} (${walked.smugmugNodeId}) not in DB — run top-level reconcile first.`
    );
  }
  const divisionId = (divRow as DivisionRow).id;

  // Pull existing locations under this division so we can reconcile by ID
  // or name without round-tripping per-row.
  const { data: existingLocs, error: locsErr } = await supabase
    .from("locations")
    .select("id, division_id, name, smugmug_folder_id")
    .eq("division_id", divisionId);
  if (locsErr) throw locsErr;
  const locById = new Map<string, LocationRow>();
  const locByName = new Map<string, LocationRow>();
  for (const row of (existingLocs as LocationRow[]) ?? []) {
    locById.set(row.smugmug_folder_id, row);
    locByName.set(normalizeName(row.name), row);
  }

  const locResult: LocationReconcileResult = { added: 0, updatedToReal: 0, unchanged: 0 };
  // Map walked location node-id → DB location id, so the week pass below
  // can attach weeks to the correct location row.
  const locationIdByNodeId = new Map<string, string>();

  for (const loc of walked.locations) {
    if (loc.type !== "Folder") continue; // skip stray albums at the location level

    const matchById = locById.get(loc.smugmugNodeId);
    if (matchById) {
      if (matchById.name !== loc.name) {
        const { error: updateError } = await supabase
          .from("locations")
          .update({ name: loc.name })
          .eq("id", matchById.id);
        if (updateError) throw updateError;
      }
      locResult.unchanged += 1;
      locationIdByNodeId.set(loc.smugmugNodeId, matchById.id);
      continue;
    }

    const matchByName = locByName.get(normalizeName(loc.name));
    if (matchByName?.smugmug_folder_id.startsWith("placeholder-")) {
      const { error: updateError } = await supabase
        .from("locations")
        .update({ smugmug_folder_id: loc.smugmugNodeId })
        .eq("id", matchByName.id);
      if (updateError) throw updateError;
      locResult.updatedToReal += 1;
      locationIdByNodeId.set(loc.smugmugNodeId, matchByName.id);
      continue;
    }

    const { data: insertedLoc, error: insertError } = await supabase
      .from("locations")
      .insert({
        division_id: divisionId,
        name: loc.name,
        smugmug_folder_id: loc.smugmugNodeId,
      })
      .select("id")
      .single();
    if (insertError || !insertedLoc) throw insertError ?? new Error("insert returned no row");
    locResult.added += 1;
    locationIdByNodeId.set(loc.smugmugNodeId, insertedLoc.id);
  }

  // Camp weeks: pull existing rows for this division's locations,
  // paginated to defeat PostgREST's 1000-row response cap.
  const locationIds = Array.from(locationIdByNodeId.values());
  const existingWeeks = await fetchAllExistingWeeks(supabase, locationIds);
  const weekById = new Map<string, CampWeekRow>();
  const weekByLocationName = new Map<string, CampWeekRow>();
  for (const row of existingWeeks) {
    weekById.set(row.smugmug_folder_id, row);
    weekByLocationName.set(`${row.location_id}::${normalizeName(row.name)}`, row);
  }

  const weekResult: WeekReconcileResult = {
    added: 0,
    updatedToReal: 0,
    unchanged: 0,
    skippedUnparseable: [],
    prunedOrphans: [],
    orphansKeptWithPhotos: [],
  };

  // Every week node id the walk actually saw on SmugMug (parseable or not).
  // Anything in the DB under a walked location but absent here is an orphan:
  // its folder was deleted, renamed-and-recreated (new node id), or moved.
  const aliveWeekNodeIds = new Set<string>();
  for (const loc of walked.locations) {
    if (loc.type !== "Folder") continue;
    for (const w of loc.weeks) aliveWeekNodeIds.add(w.smugmugNodeId);
    for (const y of loc.years) for (const w of y.weeks) aliveWeekNodeIds.add(w.smugmugNodeId);
  }
  // DB location id → walked location name, for orphan reporting.
  const locNameByDbId = new Map<string, string>();
  for (const loc of walked.locations) {
    const dbId = locationIdByNodeId.get(loc.smugmugNodeId);
    if (dbId) locNameByDbId.set(dbId, loc.name);
  }

  for (const loc of walked.locations) {
    if (loc.type !== "Folder") continue;
    const dbLocId = locationIdByNodeId.get(loc.smugmugNodeId);
    if (!dbLocId) continue; // shouldn't happen, but defensive

    const flattenedWeeks = [
      ...loc.weeks,
      ...loc.years.flatMap((y) => y.weeks),
    ];

    for (const week of flattenedWeeks) {
      if (!week.parsed) {
        weekResult.skippedUnparseable.push({
          name: week.name,
          smugmugNodeId: week.smugmugNodeId,
          locationName: loc.name,
        });
        continue;
      }

      const matchById = weekById.get(week.smugmugNodeId);
      if (matchById) {
        // Update name / dates if they drifted (e.g. admin renamed the album).
        const drifted =
          matchById.name !== week.name ||
          matchById.starts_on !== week.parsed.startDate ||
          matchById.ends_on !== week.parsed.endDate;
        if (drifted) {
          const { error: updateError } = await supabase
            .from("camp_weeks")
            .update({
              name: week.name,
              starts_on: week.parsed.startDate,
              ends_on: week.parsed.endDate,
            })
            .eq("id", matchById.id);
          if (updateError) throw updateError;
        }
        weekResult.unchanged += 1;
        continue;
      }

      const matchByName = weekByLocationName.get(`${dbLocId}::${normalizeName(week.name)}`);
      if (matchByName?.smugmug_folder_id.startsWith("placeholder-")) {
        const { error: updateError } = await supabase
          .from("camp_weeks")
          .update({
            smugmug_folder_id: week.smugmugNodeId,
            starts_on: week.parsed.startDate,
            ends_on: week.parsed.endDate,
          })
          .eq("id", matchByName.id);
        if (updateError) throw updateError;
        weekResult.updatedToReal += 1;
        continue;
      }

      const { error: insertError } = await supabase
        .from("camp_weeks")
        .insert({
          location_id: dbLocId,
          name: week.name,
          smugmug_folder_id: week.smugmugNodeId,
          starts_on: week.parsed.startDate,
          ends_on: week.parsed.endDate,
        });
      if (insertError) throw insertError;
      weekResult.added += 1;
    }
  }

  await pruneOrphanedWeeks(
    supabase,
    existingWeeks,
    aliveWeekNodeIds,
    locNameByDbId,
    weekResult
  );

  return {
    divisionName: walked.name,
    locations: locResult,
    weeks: weekResult,
  };
}

/**
 * Remove camp_weeks rows whose SmugMug folder is gone from the walk.
 *
 * Why this matters: the quality-review hub only surfaces each location's
 * *earliest* in-window week (`derive_camp_week_triage_role` keys off the
 * minimum `starts_on`, id as tiebreaker — it never checks whether a folder
 * or photos exist). A stale row left behind by a deleted / recreated /
 * moved folder keeps an early `starts_on` and a low `id`, so it permanently
 * wins the `first_week` slot: it shows as "Upcoming" forever (no folder ⇒
 * no photos), while the real weeks fall to `triage_role = 'none'` and drop
 * off the hub. Pruning the orphan lets the live earliest week reclaim the
 * role.
 *
 * Deletion is limited to zero-photo orphans: photos.camp_week_id is
 * ON DELETE RESTRICT, and a week that still holds photos may carry reviewed
 * work we must not discard. Such orphans are reported, not deleted.
 */
async function pruneOrphanedWeeks(
  supabase: SupabaseClient,
  existingWeeks: CampWeekRow[],
  aliveWeekNodeIds: Set<string>,
  locNameByDbId: Map<string, string>,
  weekResult: WeekReconcileResult
): Promise<void> {
  const orphans = existingWeeks.filter(
    (w) =>
      !aliveWeekNodeIds.has(w.smugmug_folder_id) &&
      !w.smugmug_folder_id.startsWith("placeholder-")
  );
  if (orphans.length === 0) return;

  // Which orphans still hold photos? Those can't be deleted (FK RESTRICT)
  // and may carry reviewed history — keep + report them.
  const orphanIds = orphans.map((w) => w.id);
  const withPhotos = new Set<string>();
  const PHOTO_PROBE_BATCH = 200;
  for (let i = 0; i < orphanIds.length; i += PHOTO_PROBE_BATCH) {
    const batch = orphanIds.slice(i, i + PHOTO_PROBE_BATCH);
    const { data, error } = await supabase
      .from("photos")
      .select("camp_week_id")
      .in("camp_week_id", batch);
    if (error) throw new Error(`orphan-week photo probe failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ camp_week_id: string }>) {
      withPhotos.add(row.camp_week_id);
    }
  }

  const deletableIds: string[] = [];
  for (const w of orphans) {
    const detail = {
      name: w.name,
      smugmugNodeId: w.smugmug_folder_id,
      locationName: locNameByDbId.get(w.location_id) ?? "—",
    };
    if (withPhotos.has(w.id)) {
      weekResult.orphansKeptWithPhotos.push(detail);
    } else {
      deletableIds.push(w.id);
      weekResult.prunedOrphans.push(detail);
    }
  }

  const DELETE_BATCH = 200;
  for (let i = 0; i < deletableIds.length; i += DELETE_BATCH) {
    const batch = deletableIds.slice(i, i + DELETE_BATCH);
    const { error } = await supabase.from("camp_weeks").delete().in("id", batch);
    if (error) throw new Error(`orphan-week delete failed: ${error.message}`);
  }
}
