import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Weekly upload-alert check, called by Vercel Cron on Wednesday at 10:00 UTC
 * (~6am ET) — a comfortable margin after the 08:00 UTC daily photo sync, so the
 * check always runs against freshly-synced data and can't race a long sync.
 *
 * Auth mirrors /api/smugmug/sync-scheduled: a shared `CRON_SECRET` sent as
 * `Authorization: Bearer ...`, which Vercel includes automatically for cron
 * runs. There is no user session; generate_upload_alerts() runs under the
 * service role.
 *
 * GET /api/alerts/weekly-upload-check
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Loud-fail on missing config so a deploy without the secret can't silently
    // leave the endpoint open. The cron run retries next week.
    return NextResponse.json(
      { ok: false, error: "cron_secret_not_configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("generate_upload_alerts");

  if (error) {
    console.error("[weekly-upload-check GET] error:", error);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: error.message },
      { status: 500 },
    );
  }

  const created = Array.isArray(data) ? data.length : 0;
  return NextResponse.json({ ok: true, created });
}
