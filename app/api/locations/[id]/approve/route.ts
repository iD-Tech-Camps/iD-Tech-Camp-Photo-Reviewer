import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: locationId } = await ctx.params;
  if (!locationId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const seasonStart = (body?.season_start as string | undefined) ?? null;

  const { data, error } = await auth.supabase.rpc("approve_location", {
    p_location_id: locationId,
    p_season_start: seasonStart,
  });

  if (error) {
    // 23505 = unique_violation on the active-approval partial index: another
    // lead approved this location concurrently.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "already_approved", message: "Location already approved for this season." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ approval: data });
}
