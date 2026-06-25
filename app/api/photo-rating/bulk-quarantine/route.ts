import { NextResponse } from "next/server";
import { requireRole, createServiceClient } from "@/lib/api-auth";
import { runQuarantineReconcile } from "@/lib/smugmug/sync/quarantine";
import { mapWithConcurrency } from "@/lib/smugmug/sync/concurrency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Each photo costs one SmugMug PATCH; cap + bounded concurrency keep a bulk
// toggle inside the serverless window.
export const maxDuration = 60;

const MAX_PHOTOS = 60;

/**
 * Bulk "Hide from parent view" / "Restore parent view" from the Photo Library
 * multi-select toolbar. Same semantics as the single-photo toggle
 * (app/api/photo-rating/quarantine): writes `photos.is_quarantined` directly —
 * no event appended — then reconciles each photo's SmugMug `Image.Hidden` flag.
 *
 * Restricted to seniors/admins (the bulk toolbar only exposes it to them),
 * mirroring bulk rating override. The single-photo route additionally allows a
 * reviewer to toggle their own work; bulk has no such path.
 */
export async function POST(request: Request) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoIds = body?.photo_ids;
  const quarantined = body?.quarantined;

  if (
    !Array.isArray(photoIds) ||
    photoIds.length === 0 ||
    !photoIds.every((x) => typeof x === "string")
  ) {
    return NextResponse.json(
      { error: "photo_ids must be a non-empty array of strings" },
      { status: 400 },
    );
  }
  if (photoIds.length > MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Too many photos (max ${MAX_PHOTOS})` },
      { status: 400 },
    );
  }
  if (typeof quarantined !== "boolean") {
    return NextResponse.json({ error: "`quarantined` must be a boolean" }, { status: 400 });
  }

  const service = createServiceClient();
  // .select("id") returns only the rows actually updated (those in the 'rated'
  // state), so `updated` is accurate even if the selection includes non-rated
  // photos, and we only reconcile photos we actually changed.
  const { data, error } = await service
    .from("photos")
    .update({ is_quarantined: quarantined })
    .in("id", photoIds)
    .eq("rating_state", "rated")
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updatedIds = (data ?? []).map((r) => r.id as string);
  // Reconcile each photo's SmugMug Hidden flag from the freshly-written DB
  // state, bounded so a large selection doesn't fan out unbounded PATCHes.
  // runQuarantineReconcile never throws; drift lands in sync_log.
  await mapWithConcurrency(updatedIds, 5, (id) => runQuarantineReconcile(service, id));

  return NextResponse.json({ ok: true, updated: updatedIds.length });
}
