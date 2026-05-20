import { NextResponse } from "next/server";
import { countActiveRatingClaimsForReviewer } from "@/lib/photo-rating-claims";
import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MAX_ACTIVE_CLAIMS = 3;

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const campWeekId = body?.camp_week_id as string | undefined;
  const sliceSize = Number(body?.slice_size);
  if (!campWeekId || !Number.isFinite(sliceSize) || sliceSize < 1) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const active = await countActiveRatingClaimsForReviewer(auth.supabase, auth.user.id);
  if (active >= MAX_ACTIVE_CLAIMS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ACTIVE_CLAIMS} active claims` },
      { status: 409 },
    );
  }

  const { data, error } = await auth.supabase
    .from("photo_rating_claims")
    .insert({
      camp_week_id: campWeekId,
      reviewer_id: auth.user.id,
      slice_size: sliceSize,
    })
    .select("id, camp_week_id, slice_size, claimed_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ claim: data });
}
