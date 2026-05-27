import { NextResponse } from "next/server";
import { requireRole, requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: locationId } = await ctx.params;
  if (!locationId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("location_feedback_events")
    .select(
      "id, location_id, author_id, body, camp_week_id, created_at, location_feedback_event_tags(tag_id)",
    )
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}

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
  const text = (body?.body as string | undefined)?.trim();
  const campWeekId = (body?.camp_week_id as string | undefined) ?? null;
  const tagIds = (body?.tag_ids as string[] | undefined) ?? [];

  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const { data: event, error } = await auth.supabase
    .from("location_feedback_events")
    .insert({
      location_id: locationId,
      author_id: auth.user.id,
      body: text,
      camp_week_id: campWeekId,
    })
    .select("id, location_id, author_id, body, camp_week_id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (tagIds.length > 0) {
    const rows = tagIds.map((tag_id) => ({ event_id: event.id, tag_id }));
    const { error: tagErr } = await auth.supabase
      .from("location_feedback_event_tags")
      .insert(rows);
    if (tagErr) {
      return NextResponse.json({ error: tagErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ event });
}
