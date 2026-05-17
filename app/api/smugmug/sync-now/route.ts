import { NextResponse } from "next/server";
import { syncEnvMissing } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SmugMugApiError } from "@/lib/smugmug";
import { runPhotoSync } from "@/lib/smugmug/sync/photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 5 minutes; only takes effect on Vercel Pro+. Hobby remains capped at 10s.
export const maxDuration = 300;

function describeError(err: unknown): { message: string; details?: unknown } {
  if (err instanceof Error) {
    const detail: Record<string, unknown> = {};
    if ("cause" in err && err.cause) detail.cause = describeError(err.cause).message;
    return { message: err.message, details: Object.keys(detail).length ? detail : undefined };
  }
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

/**
 * Step 8.4 — manual photo-sync endpoint. Admin-gated; the admin's id is
 * recorded on the sync_log row's `triggered_by`. The actual reconciliation
 * lives in lib/smugmug/sync/photos.ts; this handler is just auth + service-
 * role glue + response shaping.
 *
 * POST /api/smugmug/sync-now
 *   Walks every camp_week under a synced=true division whose
 *   starts_on >= the current mode's cutoff date (smugmug_config.season_start_date
 *   in summer, earliest_fetch_date in off_season), enumerates each album's
 *   images, and reconciles them into public.photos.
 *
 *   Returns { ok, status, scope, photosAdded, photosUpdated, photosRemoved,
 *             errorSummary, perWeekErrors, syncLogId }.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const missing = syncEnvMissing();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_config_incomplete",
        message:
          "Photo sync is not configured on this deployment. Add the missing environment variables in Vercel and redeploy.",
        missing,
      },
      { status: 503 }
    );
  }

  const service = createServiceClient();

  try {
    const result = await runPhotoSync(service, {
      kind: "manual",
      triggeredBy: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync-now POST] error:", err);
    if (err instanceof SmugMugApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: "smugmug_api_error",
          status: err.status,
          url: err.url,
          body: err.bodyExcerpt,
        },
        { status: 502 }
      );
    }
    const desc = describeError(err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: desc.message, details: desc.details },
      { status: 500 }
    );
  }
}
