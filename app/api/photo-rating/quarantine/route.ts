import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { runQuarantineReconcile } from "@/lib/smugmug/sync/quarantine";
import type { Role } from "@/lib/current-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * "Hide from parent view" toggle from the Photo Library lightbox. Writes the
 * same `photos.is_quarantined` flag that the Camp Photo Review checkbox
 * (quarantine_intent → trigger) and the Camp Quality Review screen's
 * Hide/Restore buttons (senior_quarantine / senior_release_quarantine →
 * trigger) write, so the status is shared across all three screens. After the
 * flip it reconciles the SmugMug-side `Image.Hidden` flag so parents stop /
 * start seeing the photo.
 *
 * Unlike those triage/rating flows this does NOT append an event — it's a
 * behind-the-scenes correction from the marketing gallery, mirroring the
 * rating-override endpoint. Skipping the event also avoids the triage trigger's
 * `triage_maybe_enter_senior_review` side effect, which would otherwise drag a
 * camp week into lead review purely because a marketer toggled visibility.
 *
 * Allowed for seniors/admins (any photo) and a photo's own current rater — the
 * same rule as the rating-override endpoint. photos UPDATE is service-role-only
 * under RLS, so the write goes through the service client after this app-level
 * authorization check.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoId = body?.photo_id as string | undefined;
  const quarantined = body?.quarantined;
  if (!photoId || typeof quarantined !== "boolean") {
    return NextResponse.json(
      { error: "photo_id and a boolean `quarantined` are required" },
      { status: 400 },
    );
  }

  // Authorize: senior/admin may toggle any photo; everyone else only a photo
  // they are the current rater of.
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  const privileged = profile?.role === ("senior" as Role) || profile?.role === ("admin" as Role);

  if (!privileged) {
    const { data: latest } = await auth.supabase
      .from("photo_rating_events")
      .select("reviewer_id")
      .eq("photo_id", photoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || latest.reviewer_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const service = createServiceClient();
  const { error } = await service
    .from("photos")
    .update({ is_quarantined: quarantined })
    .eq("id", photoId)
    .eq("rating_state", "rated");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reconcile the SmugMug-side Hidden flag from the freshly-written DB state.
  // Never throws; drift lands in sync_log for the admin to see.
  const result = await runQuarantineReconcile(service, photoId);

  return NextResponse.json({ ok: true, drift: result.drift });
}
