import { NextResponse } from "next/server";
import { triggerQuarantineMove } from "@/lib/quarantine-trigger";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// 60 seconds: reviewer's in-flight event survives a drain that landed
// during their batch. Beyond the window, treat the location as closed.
const APPROVE_GRACE_WINDOW_MS = 60_000;

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

  // Grace window check: if the photo's location was approved within the last
  // 60 seconds, accept this event (the reviewer was mid-batch). Beyond that
  // window, return 410 Gone so the client can show a clean "location closed"
  // state.
  const { data: photo, error: photoErr } = await auth.supabase
    .from("photos")
    .select("id, camp_weeks!inner(location_id)")
    .eq("id", photoId)
    .single<{ id: string; camp_weeks: { location_id: string } }>();

  if (photoErr || !photo) {
    return NextResponse.json(
      { error: photoErr?.message ?? "photo not found" },
      { status: 404 },
    );
  }

  const locationId = photo.camp_weeks.location_id;

  const { data: activeApproval } = await auth.supabase
    .from("location_approvals")
    .select("approved_at")
    .eq("location_id", locationId)
    .is("revoked_at", null)
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ approved_at: string }>();

  let approvedDuringBatch = false;
  if (activeApproval) {
    const ageMs = Date.now() - new Date(activeApproval.approved_at).getTime();
    if (ageMs > APPROVE_GRACE_WINDOW_MS) {
      return NextResponse.json(
        {
          error: "location_approved",
          message: "This location was approved; new events are no longer accepted.",
        },
        { status: 410 },
      );
    }
    approvedDuringBatch = true;
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

  return NextResponse.json({
    eventId: event.id,
    ...(approvedDuringBatch ? { location_approved_during_batch: true } : {}),
  });
}
