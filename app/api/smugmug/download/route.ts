import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizationHeader, loadCredentialsFromEnv } from "@/lib/smugmug/oauth";

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

  // iD Tech's SmugMug account is private, so the ArchivedUri is gated:
  // an anonymous fetch comes back 403 from the CDN. OAuth 1.0a signing
  // (same credentials we use against api.smugmug.com) authenticates the
  // download. We re-sign each redirect hop because OAuth binds the URL
  // into the signing base string — same reason `lib/smugmug/fetch.ts`
  // uses `redirect: "manual"` for the API client.
  let upstream: Response;
  try {
    upstream = await signedImageFetch(sourceUrl);
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

  // Buffer the bytes into memory rather than piping the upstream
  // ReadableStream straight back: image payloads are small enough (a
  // few MB at most for ArchivedUri) that buffering is safer than
  // relying on streaming through Vercel's Node runtime, which has been
  // finicky about cross-fetch ReadableStream pass-through in the past.
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

const MAX_REDIRECTS = 5;

/**
 * OAuth 1.0a-signed fetch for SmugMug image binaries. Unlike
 * `lib/smugmug/fetch.ts → smugmugFetch`, this one returns the raw
 * `Response` (no JSON envelope unwrap) because the body is binary.
 *
 * Re-signs each redirect hop manually for the same reason the API
 * client does: OAuth binds the request URL into the base string, and
 * undici's auto-follow would replay the original nonce against a
 * different URL — SmugMug rejects that as `oauth_problem=nonce_used`.
 */
async function signedImageFetch(initialUrl: string): Promise<Response> {
  const credentials = loadCredentialsFromEnv();
  let url = initialUrl;
  let hops = 0;
  while (true) {
    const authHeader = buildAuthorizationHeader({ method: "GET", url, credentials });
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "image/*" },
      cache: "no-store",
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      if (hops >= MAX_REDIRECTS) return res;
      url = new URL(location, url).toString();
      hops++;
      continue;
    }
    return res;
  }
}
