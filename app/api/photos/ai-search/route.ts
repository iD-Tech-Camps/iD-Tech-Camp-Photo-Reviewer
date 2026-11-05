import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, requireUser } from "@/lib/api-auth";
import { missingEnvVars } from "@/lib/server-env";
import { GEMINI_ENV_VARS } from "@/lib/ai/gemini";
import { searchPhotos } from "@/lib/ai/photo-search";
import { normalizeFilters } from "@/lib/ai/search-query";

// Natural-language photo search over AI metadata.
//
//   POST /api/photos/ai-search
//   { "query": "two girls building a robot", "filters": { "season": 2026 },
//     "limit": 24, "interpret": true, "minSimilarity": null }
//
// Auth: a signed-in user (session cookie, RLS applies), or a bot sending
// `Authorization: Bearer $PHOTO_SEARCH_API_KEY` (service role, read-only use).

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function botKeyMatches(request: Request): boolean {
  const key = process.env.PHOTO_SEARCH_API_KEY?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (!key || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  let supabase: SupabaseClient;
  if (botKeyMatches(request)) {
    supabase = createServiceClient();
  } else {
    const auth = await requireUser();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    supabase = auth.supabase;
  }

  const missing = missingEnvVars(GEMINI_ENV_VARS);
  if (missing.length) {
    return NextResponse.json({ error: "AI search is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 500) {
    return NextResponse.json({ error: "query must be 1-500 characters" }, { status: 400 });
  }
  const minSimilarity = body?.minSimilarity === null
    ? null
    : typeof body?.minSimilarity === "number" ? body.minSimilarity : undefined;

  try {
    const result = await searchPhotos(supabase, {
      query,
      filters: normalizeFilters(body?.filters),
      interpret: body?.interpret !== false,
      limit: typeof body?.limit === "number" ? body.limit : undefined,
      minSimilarity,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
