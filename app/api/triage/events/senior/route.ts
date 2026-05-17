import { NextResponse } from "next/server";
import { triggerQuarantineMove } from "@/lib/quarantine-trigger";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoId = body?.photo_id as string | undefined;
  const kind = body?.kind as
    | "senior_delete"
    | "senior_quarantine"
    | "senior_release_quarantine"
    | undefined;

  if (!photoId || !kind) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { data: event, error } = await auth.supabase
    .from("triage_events")
    .insert({
      photo_id: photoId,
      reviewer_id: auth.user.id,
      kind,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (kind === "senior_quarantine") {
    void triggerQuarantineMove(photoId);
  }

  return NextResponse.json({ eventId: event.id });
}
