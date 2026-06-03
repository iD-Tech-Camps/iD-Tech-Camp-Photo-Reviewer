import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Senior/admin rating correction from the Photo Library. This is a deliberate
 * behind-the-scenes edit of the photo's denormalized current_rating so the
 * gallery sorts/filters accurately — it does NOT append a rating event, so:
 *  - the original reviewer stays the "rated by" attribution,
 *  - no gamification points are awarded or removed,
 *  - the reviewer's rating event stays untouched in history.
 *
 * photos UPDATE is service-role-only under RLS, so the write goes through the
 * service client after a senior/admin role check (same posture as the
 * quarantine route).
 */
export async function POST(request: Request) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoId = body?.photo_id as string | undefined;
  const rating = Number(body?.rating);
  if (!photoId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be an integer 1–5" }, { status: 400 });
  }

  const { error } = await createServiceClient()
    .from("photos")
    .update({ current_rating: rating })
    .eq("id", photoId)
    .eq("rating_state", "rated");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
