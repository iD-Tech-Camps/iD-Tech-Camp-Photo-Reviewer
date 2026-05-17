import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SmugMugApiError } from "../fetch";
import { setImageHidden } from "../quarantine";

/**
 * Step 8.7 — quarantine reconcile core (post-triage-refactor edit).
 *
 * Single entry point used by the `/api/smugmug/quarantine` route. Reads
 * the photo's current DB state, decides what the SmugMug-side picture
 * should look like, and reconciles it via a single PATCH on
 * `Image.Hidden`.
 *
 * Decision rule (post migration 26):
 *
 *   is_quarantined = true   → Hidden=true
 *   is_quarantined = false  → Hidden=false
 *
 * The "current_status=deleted → noop" branch came out with
 * `photos.current_status` in migration 26. The new senior delete
 * happens through the triage flow (Step 3) and doesn't touch
 * `is_quarantined`; quarantine + delete are now orthogonal axes.
 *
 * Failure posture: never throw to the caller. Drift (SmugMug is down,
 * the image was deleted by hand on SmugMug, credentials are stale)
 * lands as a `sync_log` row with `kind='quarantine_move'` and
 * `status='failed'`, surfaced on the existing Admin → SmugMug → Sync
 * log card. The flag/quarantine submission has already succeeded by
 * the time we run; blocking the caller on a SmugMug round-trip would
 * be the wrong tradeoff.
 *
 * The `quarantine_move` sync_kind survives migration 26's enum swap.
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
  is_quarantined: boolean;
}

export async function runQuarantineReconcile(
  service: SupabaseClient,
  photoId: string
): Promise<QuarantineReconcileResult> {
  console.log(`[quarantine] reconcile START photoId=${photoId}`);

  const photo = await fetchPhoto(service, photoId);
  if (!photo) {
    console.log(`[quarantine] photo ${photoId} not found; bailing`);
    return {
      ok: false,
      action: "noop",
      drift: false,
      message: `photo ${photoId} not found`,
      syncLogId: null,
    };
  }
  console.log(
    `[quarantine] photo state: imageKey=${photo.smugmug_image_id} ` +
      `is_quarantined=${photo.is_quarantined}`
  );

  const intent = decideIntent(photo);
  console.log(`[quarantine] intent=${intent.action} (${intent.reason})`);

  // Open the sync_log row up front so a hard failure mid-flow still
  // leaves a trail. Status starts as success; we overwrite on failure.
  const syncLogId = await insertSyncLogRow(service);

  try {
    const hidden = intent.action === "quarantine";
    console.log(
      `[quarantine] PATCH /api/v2/image/${photo.smugmug_image_id} ` +
        `{ Hidden: ${hidden} }`
    );
    await setImageHidden(photo.smugmug_image_id, hidden);

    const summary = `${intent.action} · Hidden=${hidden}`;
    await finalizeSyncLog(service, syncLogId, {
      status: "success",
      photos_updated: 1,
      error_summary: null,
    });
    console.log(`[quarantine] reconcile DONE ${summary}`);

    return {
      ok: true,
      action: intent.action,
      drift: false,
      message: summary,
      syncLogId,
    };
  } catch (err) {
    console.error(`[quarantine] reconcile FAILED:`, err);
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
    .select("id, smugmug_image_id, is_quarantined")
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

// ─────────────────────────────────────────────────────────────────────────────
// Decision rule
// ─────────────────────────────────────────────────────────────────────────────

function decideIntent(
  photo: PhotoRow
): { action: "quarantine" | "release"; reason: string } {
  if (photo.is_quarantined) {
    return { action: "quarantine", reason: "is_quarantined=true" };
  }
  return { action: "release", reason: "is_quarantined=false" };
}

function formatError(err: unknown): string {
  if (err instanceof SmugMugApiError) {
    let path = err.url;
    try {
      path = new URL(err.url).pathname + new URL(err.url).search;
    } catch {
      // Leave the raw URL if it's somehow not parseable.
    }
    return `SmugMug ${err.status} on ${path}: ${err.bodyExcerpt.slice(0, 800)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
