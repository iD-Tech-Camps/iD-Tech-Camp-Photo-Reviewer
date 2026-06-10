import { NextResponse } from "next/server";
import { requireRole, createServiceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const MAX_PHOTOS = 200;

/**
 * Bulk rating correction from the Photo Library multi-select toolbar. Same
 * semantics as the single-photo override (app/api/photo-rating/override): a
 * behind-the-scenes edit of each photo's denormalized current_rating so the
 * gallery sorts/filters accurately — no rating events are appended, attribution
 * and gamification points are untouched.
 *
 * Restricted to seniors/admins (the UI only exposes the bulk "Change rating"
 * action to them). The single-photo route additionally allows a reviewer to
 * re-rate their own work; bulk has no such path. photos UPDATE is
 * service-role-only under RLS, so the write goes through the service client
 * after this role check.
 */
export async function POST(request: Request) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  const photoIds = body?.photo_ids;
  const rating = Number(body?.rating);

  if (
    !Array.isArray(photoIds) ||
    photoIds.length === 0 ||
    !photoIds.every((x) => typeof x === "string")
  ) {
    return NextResponse.json(
      { error: "photo_ids must be a non-empty array of strings" },
      { status: 400 },
    );
  }
  if (photoIds.length > MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Too many photos (max ${MAX_PHOTOS})` },
      { status: 400 },
    );
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "rating must be an integer 1–5" }, { status: 400 });
  }

  // .select("id") returns only the rows actually updated (those in the 'rated'
  // state), so `updated` is an accurate count even when the selection includes
  // photos that aren't rated.
  const { data, error } = await createServiceClient()
    .from("photos")
    .update({ current_rating: rating })
    .in("id", photoIds)
    .eq("rating_state", "rated")
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
}
