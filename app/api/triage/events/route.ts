import { NextResponse } from "next/server";
import { triggerQuarantineMove } from "@/lib/quarantine-trigger";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoId = body?.photo_id as string | undefined;
  const claimId = (body?.claim_id as string | undefined) ?? null;
  const kind = body?.kind as "clean" | "flag" | undefined;
  const tagIds = (body?.tag_ids as string[] | undefined) ?? [];
  const quarantineIntent = Boolean(body?.quarantine_intent);
  const note = (body?.note as string | undefined) ?? null;

  if (!photoId || !kind || !["clean", "flag"].includes(kind)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (kind === "flag" && tagIds.length === 0) {
    return NextResponse.json({ error: "Flag requires at least one tag" }, { status: 400 });
  }

  const { data: event, error } = await auth.supabase
    .from("triage_events")
    .insert({
      photo_id: photoId,
      reviewer_id: auth.user.id,
      claim_id: claimId,
      kind,
      quarantine_intent: quarantineIntent,
      note,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (kind === "flag" && tagIds.length > 0) {
    const rows = tagIds.map((tag_id) => ({ event_id: event.id, tag_id }));
    const { error: tagErr } = await auth.supabase.from("triage_event_tags").insert(rows);
    if (tagErr) {
      return NextResponse.json({ error: tagErr.message }, { status: 500 });
    }
  }

  if (kind === "flag" && quarantineIntent) {
    void triggerQuarantineMove(photoId);
  }

  return NextResponse.json({ eventId: event.id });
}
