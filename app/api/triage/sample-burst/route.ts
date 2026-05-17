import { NextResponse } from "next/server";
import {
  createServiceClient,
  requireRole,
  verifyCronSecret,
} from "@/lib/api-auth";
import {
  runSampleBurst,
  shouldRunScheduledBurst,
} from "@/lib/triage-sample-burst";

export const dynamic = "force-dynamic";

async function runBurst(triggeredBy: string | null, manual: boolean) {
  const service = createServiceClient();
  const { data: cfg } = await service
    .from("triage_config")
    .select("sample_burst_dow, sample_burst_hour")
    .eq("id", 1)
    .single();

  if (!manual && cfg) {
    if (!shouldRunScheduledBurst(cfg.sample_burst_dow, cfg.sample_burst_hour)) {
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  const { data: logRow } = await service
    .from("sync_log")
    .insert({ kind: "triage_sample", status: "success", triggered_by: triggeredBy })
    .select("id")
    .single();

  try {
    const result = await runSampleBurst(service);
    await service
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        photos_added: result.photosMarked,
        error_summary: `weeks=${result.weeksTouched}`,
      })
      .eq("id", logRow?.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logRow?.id) {
      await service
        .from("sync_log")
        .update({ finished_at: new Date().toISOString(), status: "failed", error_summary: msg })
        .eq("id", logRow.id);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runBurst(null, false);
}

export async function POST(request: Request) {
  if (verifyCronSecret(request)) {
    return runBurst(null, false);
  }

  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  return runBurst(auth.user.id, true);
}
