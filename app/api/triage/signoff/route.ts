import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

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

  const { error } = await auth.supabase.rpc("triage_signoff_camp_week", {
    p_camp_week_id: campWeekId,
    p_flag_second_week_recheck: flagRecheck,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
