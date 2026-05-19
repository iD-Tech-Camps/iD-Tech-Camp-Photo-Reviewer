import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const auth = await requireRole(["admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const sourceKind = body?.source_kind as string | undefined;
  const points = body?.points;

  if (sourceKind !== "triage_event") {
    return NextResponse.json({ error: "Invalid source_kind" }, { status: 400 });
  }
  if (typeof points !== "number" || !Number.isInteger(points) || points < 0) {
    return NextResponse.json({ error: "points must be a non-negative integer" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("points_rules")
    .update({ points, updated_at: new Date().toISOString() })
    .eq("source_kind", sourceKind)
    .select("source_kind, points, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    source_kind: data.source_kind,
    points: data.points,
    updated_at: data.updated_at,
  });
}
