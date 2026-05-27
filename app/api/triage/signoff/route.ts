import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Dual-write shim during phases 2-3 of the location-approval refactor.
// Resolves the camp_week → location, then:
//   1. Inserts a location_approvals row (new model — drains in-flight triage).
//   2. Writes the legacy camp_weeks.signoff_at / signoff_by columns so the old
//      senior-review screen keeps rendering historical signoff state.
// Removed entirely in phase 4. The flag_second_week_recheck parameter is
// silently dropped (the new model has no sibling-week side effects); we log a
// warning when callers still set it so we know if anything depends on it.
export async function POST(request: Request) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const campWeekId = body?.camp_week_id as string | undefined;
  const flagRecheck = Boolean(body?.flag_second_week_recheck);

  if (!campWeekId) {
    return NextResponse.json({ error: "camp_week_id required" }, { status: 400 });
  }

  if (flagRecheck) {
    console.warn(
      "[/api/triage/signoff] flag_second_week_recheck is deprecated; the location-approval model has no sibling-week side effects.",
    );
  }

  // Resolve camp_week → location.
  const { data: week, error: weekErr } = await auth.supabase
    .from("camp_weeks")
    .select("id, location_id")
    .eq("id", campWeekId)
    .single();

  if (weekErr || !week) {
    return NextResponse.json(
      { error: weekErr?.message ?? "camp_week not found" },
      { status: 404 },
    );
  }

  // Single SECURITY DEFINER RPC does both writes atomically: new
  // location_approvals row + legacy camp_weeks.signoff_at/signoff_by columns.
  // Phase 4 drops the legacy parameter and the column writes.
  const { error: approveErr } = await auth.supabase.rpc("approve_location", {
    p_location_id: week.location_id,
    p_season_start: null,
    p_legacy_camp_week_id: campWeekId,
  });
  if (approveErr && approveErr.code !== "23505") {
    // 23505 = already approved this season; treat as idempotent.
    return NextResponse.json({ error: approveErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
