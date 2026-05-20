import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;

  const { data: claim, error: readErr } = await auth.supabase
    .from("photo_rating_claims")
    .select("id, reviewer_id, released_at")
    .eq("id", id)
    .single();

  if (readErr || !claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();

  const isOwner = claim.reviewer_id === auth.user.id;
  const isAdmin = profile?.role === "admin";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (claim.released_at) {
    return NextResponse.json({ ok: true, alreadyReleased: true });
  }

  const { error } = await auth.supabase
    .from("photo_rating_claims")
    .update({
      released_at: new Date().toISOString(),
      release_reason: isAdmin && !isOwner ? "admin_force" : "explicit",
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
