import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  try {
    return await handle(req);
  } catch (err) {
    console.error("[/api/smugmug/download] uncaught:", err);
    return NextResponse.json(
      {
        error: "unexpected_error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest) {
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

  // `photos` has a SELECT policy for authenticated users, so the
  // session-scoped client is enough. (Avoiding `createServiceClient`
  // here also keeps this route working when SUPABASE_SERVICE_ROLE_KEY
  // hasn't been pushed to the deployment environment yet.)
  const { data: photo, error } = await supabase
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
  //
  // SmugMug's CDN bot-filters requests without a sensible User-Agent
  // (returns an empty 200 body or a 403 depending on the path), so we
  // send a vanilla desktop UA. We also buffer the bytes into memory
  // rather than piping the upstream ReadableStream straight back: image
  // payloads are small enough (a few MB at most for ArchivedUri) that
  // buffering is safer than relying on streaming through Vercel's
  // Node runtime, which has been finicky about cross-fetch ReadableStream
  // pass-through in the past.
  let upstream: Response;
  try {
    upstream = await fetch(sourceUrl, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
  } catch (err) {
    console.error("[/api/smugmug/download] upstream fetch failed:", err);
    return NextResponse.json(
      {
        error: "upstream_fetch_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    const bodyExcerpt = await upstream.text().then((t) => t.slice(0, 400)).catch(() => "");
    return NextResponse.json(
      { error: "upstream_not_ok", status: upstream.status, body: bodyExcerpt },
      { status: 502 },
    );
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await upstream.arrayBuffer();
  } catch (err) {
    console.error("[/api/smugmug/download] read upstream body failed:", err);
    return NextResponse.json(
      {
        error: "upstream_read_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const filename = `${row.smugmug_image_id}.${ext}`;
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
