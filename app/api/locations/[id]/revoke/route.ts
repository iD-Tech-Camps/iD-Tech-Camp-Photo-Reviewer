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
  const reason = (body?.reason as string | undefined) ?? null;

  const { data, error } = await auth.supabase.rpc("revoke_location", {
    p_location_id: locationId,
    p_reason: reason,
  });

  if (error) {
    // P0002 = no active approval to revoke (raised by the RPC).
    if (error.code === "P0002") {
      return NextResponse.json(
        { error: "not_approved", message: "Location has no active approval to revoke." },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ approval: data });
}
