import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function describeError(err: unknown): { message: string; details?: unknown } {
  if (err instanceof Error) return { message: err.message };
  if (err && typeof err === "object") {
    try {
      const flat = JSON.parse(JSON.stringify(err));
      const message =
        (flat && typeof flat === "object" && typeof flat.message === "string"
          ? flat.message
          : null) ?? "Unknown object error";
      return { message, details: flat };
    } catch {
      return { message: Object.prototype.toString.call(err) };
    }
  }
  return { message: String(err) };
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, body: { error: "Unauthorized" } };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return { ok: false as const, status: 403, body: { error: "Forbidden" } };
  }
  return { ok: true as const, userId: user.id };
}

const DELETE_BATCH_SIZE = 1000;

/**
 * Step 8.5 — "Clear the queue" handler. Admin-gated; deletes every
 * pending photo with no `reviews` history. Photos that have any review
 * row are preserved (review history is forever — same rule the 8.4
 * sync engine enforces).
 *
 * Called from the Admin → SmugMug edit-config modal when the admin
 * picks "Switch and clear the queue" after a mode change. Also safe to
 * call standalone (the kind = 'mode_switch' label still describes the
 * intent — the queue is being reset because operating context changed).
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const service = createServiceClient();

  let syncLogId: string | null = null;
  try {
    // 1. Resolve the photo ids to delete: pending + zero reviews.
    //    Two-step: pull all pending ids (paginated to defeat the 1000-
    //    row select cap), pull all photo_ids that have any review row,
    //    subtract.
    const pendingIds = await fetchAllPendingPhotoIds(service);

    let reviewedSet = new Set<string>();
    if (pendingIds.length > 0) {
      reviewedSet = await fetchReviewedPhotoIds(service, pendingIds);
    }
    const deletable = pendingIds.filter((id) => !reviewedSet.has(id));

    // 2. Insert in-flight sync_log row.
    const { data: logRow, error: logErr } = await service
      .from("sync_log")
      .insert({
        kind: "mode_switch",
        status: "success", // placeholder; finalized below
        triggered_by: auth.userId,
      })
      .select("id")
      .single();
    if (logErr || !logRow) throw new Error(`sync_log insert failed: ${logErr?.message ?? "no row"}`);
    syncLogId = logRow.id as string;

    // 3. Chunked DELETE — Postgres parameter limits + URL length on the
    //    PostgREST `id=in.(...)` query string both cap how many ids we
    //    can pass per call. 1000 is comfortably under both.
    let removed = 0;
    for (let i = 0; i < deletable.length; i += DELETE_BATCH_SIZE) {
      const chunk = deletable.slice(i, i + DELETE_BATCH_SIZE);
      const { error: delErr } = await service
        .from("photos")
        .delete()
        .in("id", chunk);
      if (delErr) throw new Error(`photos delete failed: ${delErr.message}`);
      removed += chunk.length;
    }

    // 4. Finalize sync_log + smugmug_config.last_sync_*.
    const finishedAt = new Date().toISOString();
    await service
      .from("sync_log")
      .update({
        finished_at: finishedAt,
        status: "success",
        photos_removed: removed,
      })
      .eq("id", syncLogId);

    await service
      .from("smugmug_config")
      .update({
        last_sync_at: finishedAt,
        last_sync_status: `mode_switch · -${removed}`,
        updated_at: finishedAt,
      })
      .eq("id", 1);

    return NextResponse.json({
      ok: true,
      photosRemoved: removed,
      photosPreserved: pendingIds.length - removed,
      syncLogId,
    });
  } catch (err) {
    console.error("[clear-pending POST] error:", err);
    if (syncLogId) {
      await service
        .from("sync_log")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error_summary: err instanceof Error ? err.message : String(err),
        })
        .eq("id", syncLogId);
    }
    const desc = describeError(err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: desc.message, details: desc.details },
      { status: 500 }
    );
  }
}

async function fetchAllPendingPhotoIds(
  service: ReturnType<typeof createServiceClient>,
): Promise<string[]> {
  const pageSize = 1000;
  const out: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await service
      .from("photos")
      .select("id")
      .eq("current_status", "pending")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`photos id fetch failed: ${error.message}`);
    const rows = (data ?? []) as { id: string }[];
    out.push(...rows.map((r) => r.id));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function fetchReviewedPhotoIds(
  service: ReturnType<typeof createServiceClient>,
  pendingIds: string[],
): Promise<Set<string>> {
  // Chunk the IN(...) clause to keep the query string bounded.
  const chunkSize = 500;
  const reviewed = new Set<string>();
  for (let i = 0; i < pendingIds.length; i += chunkSize) {
    const chunk = pendingIds.slice(i, i + chunkSize);
    const { data, error } = await service
      .from("reviews")
      .select("photo_id")
      .in("photo_id", chunk);
    if (error) throw new Error(`reviews lookup failed: ${error.message}`);
    for (const r of (data ?? []) as { photo_id: string }[]) {
      reviewed.add(r.photo_id);
    }
  }
  return reviewed;
}
