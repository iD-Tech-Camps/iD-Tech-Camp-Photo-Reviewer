import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getImage, getImageSizeDetails, type ImageSizeOption } from "@/lib/smugmug/images";
import { SMUGMUG_SIZES, type SmugMugSize } from "@/lib/smugmug/url-variants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Streaming the original (size O) can be 10+ MB; give the fetch + pipe room.
export const maxDuration = 60;

const SIZE_LABELS: Record<SmugMugSize, string> = {
  Ti: "Tiny",
  Th: "Thumbnail",
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "X-Large",
  X2: "2X-Large",
  X3: "3X-Large",
  X4: "4X-Large",
  X5: "5X-Large",
  O: "Original",
};

function isSmugMugSize(s: string): s is SmugMugSize {
  return (SMUGMUG_SIZES as readonly string[]).includes(s);
}

/**
 * Photo Library download endpoint.
 *
 *   GET ?photoId=…&stored=1      → streams the image_url we already store (no API call)
 *   GET ?photoId=…&action=sizes  → JSON list of usable download sizes
 *   GET ?photoId=…&size=XL       → streams the file as an attachment
 *
 * The "stored" path is the default download button — it streams the full-size
 * image URL already on the photo row, so the common case makes zero SmugMug
 * API calls. The size menu / specific-size paths hit the SmugMug v2 API
 * (!sizedetails) so we never offer a size the image doesn't actually have.
 * Either way the file is streamed through the server (rather than redirecting
 * to photos.smugmug.com) so the browser saves it with a real filename.
 *
 * Auth: any signed-in user (the Photo Library is open to everyone).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const photoId = req.nextUrl.searchParams.get("photoId");
  const action = req.nextUrl.searchParams.get("action");
  const sizeParam = req.nextUrl.searchParams.get("size");
  const stored = req.nextUrl.searchParams.get("stored") === "1";

  if (!photoId) {
    return NextResponse.json({ error: "photoId_required" }, { status: 400 });
  }

  const { data: photo, error } = await auth.supabase
    .from("photos")
    .select("smugmug_image_id, image_url")
    .eq("id", photoId)
    .single();
  if (error || !photo) {
    return NextResponse.json({ error: "photo_not_found" }, { status: 404 });
  }
  const imageKey = (photo as { smugmug_image_id: string }).smugmug_image_id;
  const storedUrl = (photo as { image_url: string | null }).image_url;

  // Default download — stream the URL we already store, no SmugMug API call.
  if (stored) {
    if (!storedUrl) {
      return NextResponse.json({ error: "no_stored_image" }, { status: 404 });
    }
    const ext = storedUrl.split("?")[0].split(".").pop() || "jpg";
    return streamAttachment(storedUrl, `${imageKey}.${ext}`);
  }

  let sizes: ImageSizeOption[];
  try {
    sizes = await getImageSizeDetails(imageKey);
  } catch (err) {
    return NextResponse.json(
      { error: "smugmug_error", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Size menu for the lightbox dropdown.
  if (action === "sizes" || !sizeParam) {
    return NextResponse.json({
      sizes: sizes.map((s) => ({
        size: s.size,
        label: SIZE_LABELS[s.size],
        width: s.width,
        height: s.height,
      })),
    });
  }

  // Stream a specific size.
  if (!isSmugMugSize(sizeParam)) {
    return NextResponse.json({ error: "invalid_size" }, { status: 400 });
  }
  const chosen = sizes.find((s) => s.size === sizeParam);
  if (!chosen) {
    return NextResponse.json({ error: "size_unavailable" }, { status: 404 });
  }

  let filename = `${imageKey}-${sizeParam}.${chosen.ext ?? "jpg"}`;
  try {
    const img = await getImage(imageKey);
    if (img.FileName) {
      const dot = img.FileName.lastIndexOf(".");
      const base = dot > 0 ? img.FileName.slice(0, dot) : img.FileName;
      const ext = chosen.ext ?? (dot > 0 ? img.FileName.slice(dot + 1) : "jpg");
      filename = `${base}-${sizeParam}.${ext}`;
    }
  } catch {
    // Non-fatal — fall back to the imageKey-based filename.
  }

  return streamAttachment(chosen.url, filename);
}

// Fetch an upstream image and re-emit it as a download attachment so the
// browser saves it with a real filename instead of opening it inline.
async function streamAttachment(url: string, filename: string): Promise<NextResponse> {
  const upstream = await fetch(url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "fetch_failed", status: upstream.status }, { status: 502 });
  }
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  headers.set("Cache-Control", "no-store");
  return new NextResponse(upstream.body, { status: 200, headers });
}
