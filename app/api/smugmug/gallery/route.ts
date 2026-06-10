import { type NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { syncEnvMissing } from "@/lib/server-env";
import { SmugMugApiError } from "@/lib/smugmug";
import { createSharedGallery } from "@/lib/smugmug/collections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Folder lookup/create + album create + chunked collect; only takes effect on
// Vercel Pro+. Hobby remains capped at 10s.
export const maxDuration = 60;

const MAX_SELECTION = 500;

/**
 * "Gather selected photos into a SmugMug gallery" — the Photo Library
 * multi-select bulk action.
 *
 *   POST { photo_ids: string[] }  → { url } (an Unlisted, link-shareable album)
 *
 * Creates a fresh Unlisted album under the "Photo Reviewer Collections" folder
 * and collects the selected (already-synced) images into it, then returns the
 * shareable gallery URL. Auth: any signed-in user.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const photoIds = body?.photo_ids;
  if (!Array.isArray(photoIds) || photoIds.length === 0 || !photoIds.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "photo_ids must be a non-empty array of strings" }, { status: 400 });
  }
  // Optional user-supplied title; collections.ts falls back to an auto-name.
  const rawName = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : "";
  const name = rawName || undefined;
  if (photoIds.length > MAX_SELECTION) {
    return NextResponse.json({ error: `Too many photos (max ${MAX_SELECTION})` }, { status: 400 });
  }

  const missing = syncEnvMissing();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "server_config_incomplete",
        message:
          "SmugMug is not configured on this deployment. Add the missing environment variables in Vercel and redeploy.",
        missing,
      },
      { status: 503 },
    );
  }

  const { data: rows, error } = await auth.supabase
    .from("photos")
    .select("id, smugmug_image_id")
    .in("id", photoIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const imageKeys = [
    ...new Set(
      ((rows ?? []) as Array<{ smugmug_image_id: string | null }>)
        .map((r) => r.smugmug_image_id)
        .filter((k): k is string => !!k),
    ),
  ];
  if (imageKeys.length === 0) {
    return NextResponse.json({ error: "no_collectible_photos" }, { status: 400 });
  }

  try {
    const { url } = await createSharedGallery(imageKeys, name ? { name } : {});
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[smugmug/gallery POST] error:", err);
    if (err instanceof SmugMugApiError) {
      return NextResponse.json(
        { error: "smugmug_api_error", status: err.status, url: err.url, body: err.bodyExcerpt },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "unexpected_error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
