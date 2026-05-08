import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SmugMugApiError } from "../fetch";
import { getImage } from "../images";
import {
  findOrCreateQuarantineAlbum,
  getImageAlbumKey,
  moveImageToAlbum,
  type QuarantineAlbumIdentity,
} from "../quarantine";

/**
 * Step 8.7 — quarantine reconcile core.
 *
 * Single entry point used by the `/api/smugmug/quarantine` route. Reads
 * the photo's current DB state (which the `reviews_update_quarantine`
 * trigger has already written by the time we run), decides what the
 * SmugMug-side picture should look like, and reconciles it.
 *
 * Decision rule:
 *
 *   is_quarantined = true                                 → move into Quarantined album
 *   is_quarantined = false  AND  current_status = deleted → noop, image stays put
 *   is_quarantined = false  AND  current_status <> deleted → move back to camp_week album
 *
 * The "deleted = noop" branch is intentional: a senior delete records
 * `current_status = 'deleted'` and clears the quarantine flag, but the
 * photo is exiting all queues and there's no reason to spend a SmugMug
 * round-trip moving an image that an admin will likely delete on
 * SmugMug as a separate cleanup step. It stays where it physically
 * sits — quarantine if it was quarantined, public if it wasn't.
 *
 * Failure posture: never throw to the caller. Drift (SmugMug is down,
 * an album was renamed by hand, credentials are stale) lands as a
 * `sync_log` row with `kind='quarantine_move'` and `status='failed'`,
 * surfaced on the existing Admin → SmugMug → Sync log card. The
 * reviewer's flag submission and the senior's accept/delete have
 * already succeeded by the time we run; blocking them on a SmugMug
 * round-trip would be the wrong tradeoff.
 */

export type QuarantineAction = "quarantine" | "release" | "noop";

export interface QuarantineReconcileResult {
  ok: boolean;
  action: QuarantineAction;
  /** True when SmugMug failed and the DB+SmugMug are now out of sync. */
  drift: boolean;
  /** Short human-readable explanation; populated for both success and drift. */
  message: string;
  /** sync_log row id, if one was written. */
  syncLogId: string | null;
}

interface PhotoRow {
  id: string;
  smugmug_image_id: string;
  smugmug_url: string | null;
  smugmug_folder_id: string | null;
  is_quarantined: boolean;
  current_status: "pending" | "approved" | "flagged" | "deleted";
  camp_weeks: { smugmug_folder_id: string } | null;
}

export async function runQuarantineReconcile(
  service: SupabaseClient,
  photoId: string
): Promise<QuarantineReconcileResult> {
  // 1. Read the photo + its camp_week's public album key. One join, one
  //    round-trip. The service-role client bypasses RLS — fine, this
  //    handler has no per-user authorization (anyone authenticated can
  //    fire it), and we trust the trigger to have written the truth.
  const photo = await fetchPhoto(service, photoId);
  if (!photo) {
    return {
      ok: false,
      action: "noop",
      drift: false,
      message: `photo ${photoId} not found`,
      syncLogId: null,
    };
  }

  // 2. Resolve target action. Deleted photos exit early without any
  //    SmugMug call and without a sync_log row — there's no event
  //    worth recording.
  const intent = decideIntent(photo);
  if (intent.action === "noop") {
    return {
      ok: true,
      action: "noop",
      drift: false,
      message: intent.reason,
      syncLogId: null,
    };
  }

  // 3. From here on we're going to attempt SmugMug work. Open a
  //    sync_log row up front so a hard failure mid-flow still leaves
  //    a trail. Status starts as success; we overwrite it on failure.
  const syncLogId = await insertSyncLogRow(service);

  try {
    // Pre-flight: figure out the destination album key. For 'quarantine'
    // we lazy-create-or-find the global Quarantined album; for
    // 'release' we use the camp_week's stored folder id.
    const destAlbumKey =
      intent.action === "quarantine"
        ? await ensureQuarantineAlbum(service)
        : (photo.camp_weeks?.smugmug_folder_id ?? null);

    if (!destAlbumKey) {
      throw new Error(
        intent.action === "release"
          ? "camp_week has no smugmug_folder_id; cannot release."
          : "could not resolve quarantine album key."
      );
    }

    const imageUri = `/api/v2/image/${photo.smugmug_image_id}`;

    // 4. Idempotency: GET the image, see what album it currently lives
    //    in. SmugMug's MoveImages=true is documented as a move, but
    //    behavior when source==dest is inconsistent in practice; checking
    //    first keeps the flow deterministic and saves a write call when
    //    we're already in the right place.
    const currentAlbumKey = await getImageAlbumKey(photo.smugmug_image_id);
    const alreadyInTarget = currentAlbumKey === destAlbumKey;

    if (!alreadyInTarget) {
      await moveImageToAlbum(imageUri, destAlbumKey);
    }

    // 5. Refresh URLs. SmugMug's WebUri (and sometimes ArchivedUri /
    //    ThumbnailUrl) are album-contextual: a moved image's old URLs
    //    can 404 once it leaves the source album. Senior Flag Review
    //    renders these URLs, so we always refetch the image record
    //    after a real move and update the photo row. Skip the refresh
    //    on the already-in-target path — nothing changed.
    if (!alreadyInTarget) {
      await refreshPhotoUrls(service, photo.id, photo.smugmug_image_id, destAlbumKey);
    } else {
      // Even on the no-op move path, keep smugmug_folder_id honest so
      // future calls short-circuit on the cheaper "current === target"
      // check rather than re-doing the GET dance every time.
      await service
        .from("photos")
        .update({
          smugmug_folder_id: destAlbumKey,
          updated_at: new Date().toISOString(),
        })
        .eq("id", photo.id);
    }

    // 6. Finalize sync_log row.
    const summary = alreadyInTarget
      ? `${intent.action} · already in place (${shortKey(destAlbumKey)})`
      : `${intent.action} · moved to ${shortKey(destAlbumKey)}`;
    await finalizeSyncLog(service, syncLogId, {
      status: "success",
      photos_updated: alreadyInTarget ? 0 : 1,
      error_summary: null,
    });

    return {
      ok: true,
      action: intent.action,
      drift: false,
      message: summary,
      syncLogId,
    };
  } catch (err) {
    const message = formatError(err);
    await finalizeSyncLog(service, syncLogId, {
      status: "failed",
      photos_updated: 0,
      error_summary: `quarantine ${intent.action} failed for photo ${photoId}: ${message}`,
    });
    return {
      ok: false,
      action: intent.action,
      drift: true,
      message,
      syncLogId,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPhoto(
  service: SupabaseClient,
  photoId: string
): Promise<PhotoRow | null> {
  const { data, error } = await service
    .from("photos")
    .select(
      "id, smugmug_image_id, smugmug_url, smugmug_folder_id, " +
        "is_quarantined, current_status, " +
        "camp_weeks ( smugmug_folder_id )"
    )
    .eq("id", photoId)
    .maybeSingle();
  if (error) throw new Error(`photo lookup failed: ${error.message}`);
  return (data as unknown as PhotoRow | null) ?? null;
}

async function insertSyncLogRow(service: SupabaseClient): Promise<string> {
  const { data, error } = await service
    .from("sync_log")
    .insert({
      kind: "quarantine_move",
      // Placeholder terminal state; finalized below. Inserting with a
      // real enum value (rather than NULL) keeps the NOT NULL contract
      // intact for the brief window between insert and finalize.
      status: "success",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `sync_log insert failed: ${error?.message ?? "no row returned"}`
    );
  }
  return data.id as string;
}

async function finalizeSyncLog(
  service: SupabaseClient,
  id: string,
  patch: {
    status: "success" | "partial" | "failed";
    photos_updated: number;
    error_summary: string | null;
  }
): Promise<void> {
  const { error } = await service
    .from("sync_log")
    .update({
      finished_at: new Date().toISOString(),
      ...patch,
    })
    .eq("id", id);
  if (error) {
    // Don't throw — we already have the run result and the user-facing
    // path has long since returned.
    console.error("[runQuarantineReconcile] sync_log finalize failed:", error);
  }
}

// Pull the cached AlbumKey from smugmug_config; lazy-create on miss.
// Race-safety: after creating, do a conditional UPDATE that only sets
// the column when it's still null. If a concurrent caller beat us to
// it, the UPDATE affects 0 rows and we fall back to the row's now-
// populated key. Worst case is a transient duplicate album on SmugMug
// from the very first concurrent quarantines — admin can delete by
// hand. Acceptable for a once-ever path.
async function ensureQuarantineAlbum(service: SupabaseClient): Promise<string> {
  const cached = await readQuarantineKey(service);
  if (cached) return cached;

  const album = await findOrCreateQuarantineAlbum();
  await persistQuarantineKey(service, album);

  // Re-read in case someone else beat our UPDATE — they may have
  // persisted a different (already-existing) album under a different
  // key, and we want to converge on whatever's in the DB.
  const settled = await readQuarantineKey(service);
  return settled ?? album.albumKey;
}

async function readQuarantineKey(service: SupabaseClient): Promise<string | null> {
  const { data, error } = await service
    .from("smugmug_config")
    .select("quarantine_album_key")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`smugmug_config read failed: ${error.message}`);
  const row = data as { quarantine_album_key: string | null } | null;
  return row?.quarantine_album_key ?? null;
}

async function persistQuarantineKey(
  service: SupabaseClient,
  album: QuarantineAlbumIdentity
): Promise<void> {
  const { error } = await service
    .from("smugmug_config")
    .update({
      quarantine_album_key: album.albumKey,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .is("quarantine_album_key", null);
  if (error) {
    throw new Error(`smugmug_config write failed: ${error.message}`);
  }
}

// After a real move, fetch the image record again and update the
// four URL columns + smugmug_folder_id on the photo row. Errors here
// are non-fatal for the move itself (the image is in the right place
// already); we log and let the next photo sync pick up the drift.
async function refreshPhotoUrls(
  service: SupabaseClient,
  photoId: string,
  imageKey: string,
  newAlbumKey: string
): Promise<void> {
  try {
    const img = await getImage(imageKey);
    const { error } = await service
      .from("photos")
      .update({
        image_url: img.ArchivedUri ?? img.ThumbnailUrl ?? null,
        thumbnail_url: img.ThumbnailUrl ?? null,
        smugmug_url: img.WebUri ?? null,
        smugmug_folder_id: newAlbumKey,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId);
    if (error) {
      console.error("[refreshPhotoUrls] photos update failed:", error);
    }
  } catch (err) {
    console.error("[refreshPhotoUrls] image GET failed:", err);
    // Best-effort fallback: at least record the new album key so future
    // reconcile calls can short-circuit. URL drift will resolve on the
    // next scheduled photo sync.
    await service
      .from("photos")
      .update({
        smugmug_folder_id: newAlbumKey,
        updated_at: new Date().toISOString(),
      })
      .eq("id", photoId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision rule
// ─────────────────────────────────────────────────────────────────────────────

function decideIntent(
  photo: PhotoRow
): { action: "quarantine" | "release"; reason: string } | { action: "noop"; reason: string } {
  if (photo.is_quarantined) {
    return { action: "quarantine", reason: "is_quarantined=true" };
  }
  if (photo.current_status === "deleted") {
    return {
      action: "noop",
      reason: "current_status=deleted; image stays put per spec",
    };
  }
  return { action: "release", reason: "is_quarantined=false" };
}

function shortKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 10)}…` : key;
}

function formatError(err: unknown): string {
  if (err instanceof SmugMugApiError) {
    return `SmugMug ${err.status}: ${err.bodyExcerpt.slice(0, 120)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
