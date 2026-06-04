import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";
import type { Role } from "@/lib/current-user";

export const dynamic = "force-dynamic";

/**
 * Rating correction from the Photo Library. A deliberate behind-the-scenes edit
 * of the photo's denormalized current_rating so the gallery sorts/filters
 * accurately — it does NOT append a rating event, so:
 *  - the original reviewer stays the "rated by" attribution,
 *  - no gamification points are awarded or removed,
 *  - the reviewer's rating event stays untouched in history.
 *
 * Allowed for seniors/admins (correcting anyone's rating) and for the photo's
 * own current rater (re-rating their own work). photos UPDATE is
 * service-role-only under RLS, so the write goes through the service client
 * after this app-level authorization check.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoId = body?.photo_id as string | undefined;
  const rating = Number(body?.rating);
  if (!photoId || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be an integer 1–5" }, { status: 400 });
  }

  // Authorize: senior/admin may correct any photo; everyone else may only
  // re-rate a photo they are the current rater of.
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  const privileged = profile?.role === ("senior" as Role) || profile?.role === ("admin" as Role);

  if (!privileged) {
    const { data: latest } = await auth.supabase
      .from("photo_rating_events")
      .select("reviewer_id")
      .eq("photo_id", photoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || latest.reviewer_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
