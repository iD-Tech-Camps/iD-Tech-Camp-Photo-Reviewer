import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  if (profile?.role !== "senior" && profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const campWeekId = body?.camp_week_id as string | undefined;
  const tagIds = (body?.tag_ids as string[] | undefined) ?? [];
  if (!campWeekId) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { error } = await auth.supabase.rpc("photo_rating_set_week_tags", {
    p_camp_week_id: campWeekId,
    p_tag_ids: tagIds,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
