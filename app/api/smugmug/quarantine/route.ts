import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runQuarantineReconcile } from "@/lib/smugmug/sync/quarantine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 30s ceiling; the reconcile path is a single PATCH on the SmugMug
// Image resource plus a couple of DB writes. The previous album-move
// design needed 60s for a worst-case "first quarantine creates the
// global album" run; the Hidden-flag approach has no such case.
export const maxDuration = 30;

interface QuarantineBody {
  photoId: string;
}

/**
 * Quarantine endpoint. Called by the triage flow after a reviewer
 * quarantines a photo or a senior releases one. The client doesn't tell
 * the server *what* to do — it just identifies the photo and the server
 * reads the photo's freshly-trigger-updated state to decide whether to
 * PATCH `Image.Hidden=true` (quarantine) or `false` (release).
 *
 * Authentication: any authenticated user. The actual "should I move
 * this?" call is gated by `photos.is_quarantined` (written by triggers
 * under SECURITY DEFINER), not by the caller's role. A malicious caller
 * can only ever ask us to reconcile to whatever state a real triage
 * action has already established.
 *
 * The handler always returns 200, even when SmugMug fails. The payload's
 * `drift: true` flag lets the client log a console warning while the
 * user-facing flow (toast, queue advance) doesn't block. Drift rows land
 * in `sync_log` for the admin to see on Photo sync → Sync log.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: QuarantineBody;
  try {
    body = (await req.json()) as QuarantineBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.photoId || typeof body.photoId !== "string") {
    return NextResponse.json({ error: "photoId_required" }, { status: 400 });
  }

  const service = createServiceClient();

  try {
    const result = await runQuarantineReconcile(service, body.photoId);
    return NextResponse.json(result);
  } catch (err) {
    // The reconcile core swallows its own SmugMug errors and returns
    // a result with drift=true. Anything that escapes here is a hard
    // bug (e.g. service-role client misconfigured, photoId malformed
    // through the type check). Still return 200 so the user-facing
    // flow doesn't block; surface the error in the response body so
    // a console.warn on the client side has something useful.
    console.error("[/api/smugmug/quarantine] unexpected error:", err);
    return NextResponse.json({
      ok: false,
      action: "noop",
      drift: true,
      message: err instanceof Error ? err.message : String(err),
      syncLogId: null,
    });
  }
}
