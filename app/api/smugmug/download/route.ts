import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-side proxy for downloading the full-resolution SmugMug image
 * behind a photo row. Senior- and admin-only.
 *
 * Why this exists: the SmugMug CDN host (`photos.smugmug.com`) does not
 * return CORS headers, so a client-side `fetch(image_url)` from the
 * FlagReview "Download" button is blocked by the browser even though the
 * URL itself is reachable. `<img src>` works for *display* because image
 * elements don't enforce CORS, but `fetch` + `blob()` does — and we need
 * the bytes to trigger a real browser download (a cross-origin
 * `<a download href>` falls back to a navigation, not a save).
 *
 * The proxy fetches the image server-side (no CORS), then streams the
 * bytes back as same-origin with a `Content-Disposition: attachment`
 * header so the browser actually saves the file.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = (profile as { role?: string } | null)?.role;
  if (role !== "senior" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const photoId = req.nextUrl.searchParams.get("photoId");
  if (!photoId) {
    return NextResponse.json({ error: "photoId_required" }, { status: 400 });
  }

  // Service-role read — `photos` has SELECT for authenticated users so
  // an anon-style read would work too, but the route is already gated
  // by the role check above and the service client avoids one round
  // trip's worth of RLS overhead.
  const service = createServiceClient();
  const { data: photo, error } = await service
    .from("photos")
    .select("smugmug_image_id, image_url, thumbnail_url")
    .eq("id", photoId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "photo_lookup_failed", message: error.message }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  }

  const row = photo as { smugmug_image_id: string; image_url: string | null; thumbnail_url: string | null };
  const sourceUrl = row.image_url ?? row.thumbnail_url;
  if (!sourceUrl) {
    return NextResponse.json({ error: "no_source_url" }, { status: 404 });
  }

  // Plain `fetch` — the SmugMug `ArchivedUri` is a public CDN URL that
  // does not require OAuth signing. Hidden=true (quarantined) images
  // remain reachable by direct URL; SmugMug's Hidden flag only removes
  // them from public galleries and search.
  let upstream: Response;
  try {
    upstream = await fetch(sourceUrl, { cache: "no-store", redirect: "follow" });
  } catch (err) {
    console.error("[/api/smugmug/download] upstream fetch failed:", err);
    return NextResponse.json(
      { error: "upstream_fetch_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "upstream_not_ok", status: upstream.status },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const filename = `${row.smugmug_image_id}.${ext}`;
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, { status: 200, headers });
}
