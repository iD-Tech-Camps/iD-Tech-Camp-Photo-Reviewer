import { NextResponse, type NextRequest } from "next/server";
import { syncEnvMissing } from "@/lib/server-env";
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
 * Step 8.4 — scheduled photo-sync endpoint, called by Vercel Cron at
 * 08:00 UTC daily (≈ 4am EDT during summer; 5am EST in winter).
 *
 * Auth: a shared `CRON_SECRET` env var sent as `Authorization: Bearer ...`.
 * Vercel automatically includes this header for cron-invoked requests
 * when the secret is set on the project. There is no user session for
 * cron runs — `triggered_by` on the sync_log row stays NULL, which is
 * how the admin sync-log table tells "scheduled" rows apart from manual
 * ones.
 *
 * GET /api/smugmug/sync-scheduled
 *   Same reconciliation logic as /api/smugmug/sync-now; just a different
 *   sync_kind on the audit row.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Loud-fail on missing config so a deploy without the secret can't
    // silently leave the endpoint open. The cron run will retry next
    // night; an admin can always trigger manually via /sync-now.
    return NextResponse.json(
      { ok: false, error: "cron_secret_not_configured" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const missing = syncEnvMissing();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_config_incomplete",
        message: "Scheduled sync is missing required environment variables.",
        missing,
      },
      { status: 503 }
    );
  }

  const service = createServiceClient();

  try {
    const result = await runPhotoSync(service, {
      kind: "scheduled",
      triggeredBy: null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[sync-scheduled GET] error:", err);
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
