import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "../index";
import { walkDivisions, walkDivisionDeep } from "./walker";
import {
  reconcileTopLevelDivisions,
  reconcileDivisionDeep,
} from "./reconcile";

/**
 * Folder-tree discovery + reconciliation, run as the first step of every
 * scheduled and manual photo sync. Without this step, new camp weeks
 * (and new locations / divisions) on SmugMug never enter the DB, so the
 * downstream photo walk has nothing new to enumerate.
 *
 * Behavior mirrors the admin-triggered POST /api/smugmug/sync-folders
 * route, just expressed as a library function so the photo-sync pipeline
 * can call it directly:
 *
 *   1. Walk SmugMug's root and upsert every top-level Folder into
 *      public.divisions. New rows land with synced=false — admin still
 *      has to opt a division in before its content gets photo-synced.
 *   2. For each division currently flagged synced=true in the DB,
 *      deep-walk its locations + year folders + weeks and reconcile
 *      into public.locations and public.camp_weeks. Weeks that fail the
 *      iD Tech date parser are surfaced in `unparseableWeeks`.
 *
 * Deep walks run sequentially per division to keep total SmugMug-side
 * concurrency bounded; each walk already fans out internally per
 * location/year folder.
 *
 * The Supabase client passed in MUST be a service-role client; the
 * targeted tables (divisions / locations / camp_weeks) reject
 * authenticated-role writes via RLS.
 */

export interface FolderSyncResult {
  divisionsAdded: number;
  divisionsUpdatedToReal: number;
  locationsAdded: number;
  locationsUpdatedToReal: number;
  weeksAdded: number;
  weeksUpdatedToReal: number;
  weeksPruned: number;
  unparseableWeeks: Array<{ name: string; locationName: string; smugmugNodeId: string }>;
  /** Orphaned weeks (folder gone) deleted because they had no photos. */
  prunedOrphanWeeks: Array<{ name: string; locationName: string; smugmugNodeId: string }>;
  /** Orphaned weeks kept because they still hold photos — flag for an admin. */
  orphanWeeksKeptWithPhotos: Array<{ name: string; locationName: string; smugmugNodeId: string }>;
}

interface SyncedDivisionRow {
  smugmug_folder_id: string;
}

export async function runFolderSync(
  supabase: SupabaseClient
): Promise<FolderSyncResult> {
  const smugUser = await getAuthUser();
  const { divisions } = await walkDivisions(smugUser.NickName);

  const topResult = await reconcileTopLevelDivisions(supabase, divisions);

  const { data: syncedRows, error: syncedErr } = await supabase
    .from("divisions")
    .select("smugmug_folder_id")
    .eq("synced", true);
  if (syncedErr) {
    throw new Error(`divisions synced-read failed: ${syncedErr.message}`);
  }
  const syncedFolderIds = new Set(
    (syncedRows as SyncedDivisionRow[] | null ?? []).map((r) => r.smugmug_folder_id)
  );

  const result: FolderSyncResult = {
    divisionsAdded: topResult.added,
    divisionsUpdatedToReal: topResult.updatedToReal,
    locationsAdded: 0,
    locationsUpdatedToReal: 0,
    weeksAdded: 0,
    weeksUpdatedToReal: 0,
    weeksPruned: 0,
    unparseableWeeks: [],
    prunedOrphanWeeks: [],
    orphanWeeksKeptWithPhotos: [],
  };

  for (const div of divisions) {
    if (div.type !== "Folder") continue;
    if (!syncedFolderIds.has(div.smugmugNodeId)) continue;

    const deepWalked = await walkDivisionDeep(
      div.smugmugNodeId,
      div.name,
      div.type
    );
    const deepResult = await reconcileDivisionDeep(supabase, deepWalked);
    result.locationsAdded += deepResult.locations.added;
    result.locationsUpdatedToReal += deepResult.locations.updatedToReal;
    result.weeksAdded += deepResult.weeks.added;
    result.weeksUpdatedToReal += deepResult.weeks.updatedToReal;
    result.weeksPruned += deepResult.weeks.prunedOrphans.length;
    result.unparseableWeeks.push(...deepResult.weeks.skippedUnparseable);
    result.prunedOrphanWeeks.push(...deepResult.weeks.prunedOrphans);
    result.orphanWeeksKeptWithPhotos.push(...deepResult.weeks.orphansKeptWithPhotos);
  }

  return result;
}
