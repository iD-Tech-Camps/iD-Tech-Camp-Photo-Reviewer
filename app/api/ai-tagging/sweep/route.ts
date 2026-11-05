import { NextResponse } from "next/server";
import { createServiceClient, verifyCronSecret } from "@/lib/api-auth";
import { missingEnvVars } from "@/lib/server-env";
import { GEMINI_ENV_VARS } from "@/lib/ai/gemini";
import { runTaggingSweep } from "@/lib/ai/tagging";

// Vercel cron (every 5 min): describe + embed photos that don't have AI search
// metadata yet. The same sweep handles new uploads and the historical
// backfill — the queue is newest-first, so fresh photos jump the line.
//
// Off unless AI_TAGGING_ENABLED=true, so deploying the code spends nothing.
// Tunables: AI_TAGGING_BATCH (photos per run), AI_TAGGING_CONCURRENCY.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 240_000; // stop starting new photos with ~60s of headroom

function intEnv(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.AI_TAGGING_ENABLED !== "true") {
    return NextResponse.json({ skipped: "AI_TAGGING_ENABLED is not true" });
  }
  const missing = missingEnvVars(GEMINI_ENV_VARS);
  if (missing.length) {
    return NextResponse.json({ error: `Missing env: ${missing.join(", ")}` }, { status: 500 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0
    ? Math.min(limitParam, 500)
    : intEnv("AI_TAGGING_BATCH", 400, 500);

  try {
    const result = await runTaggingSweep(createServiceClient(), {
      limit,
      concurrency: intEnv("AI_TAGGING_CONCURRENCY", 12, 32),
      budgetMs: BUDGET_MS,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
