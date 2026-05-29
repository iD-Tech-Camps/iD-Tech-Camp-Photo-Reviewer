import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Records the lead's per-week review as an audit marker on camp_weeks.
// This is intentionally NOT the queue-affecting action — approval of the
// location (which closes the triage queue for the season) lives on
// /api/locations/[id]/approve. Phase 3 of the location-approval refactor
// split these two concepts so leads can record "I reviewed this week"
// without committing to "this location is closed for the season."
export async function POST(request: Request) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const campWeekId = body?.camp_week_id as string | undefined;

  if (!campWeekId) {
    return NextResponse.json({ error: "camp_week_id required" }, { status: 400 });
  }

  const { error } = await auth.supabase.rpc("triage_signoff_camp_week", {
    p_camp_week_id: campWeekId,
  });

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json({ error: "camp week not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
