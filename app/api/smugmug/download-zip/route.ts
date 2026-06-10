import { type NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { requireUser } from "@/lib/api-auth";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";
import { mapWithConcurrency } from "@/lib/smugmug/sync/concurrency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// We bundle web-size (XL/L) images, not Originals, so the fetch + zip stays
// well under the serverless time/memory ceiling. The selection cap below is
// what keeps this true.
export const maxDuration = 60;

// Matches the gallery's PAGE_SIZE. Capped to keep the zip within maxDuration.
const MAX_SELECTION = 60;
const FETCH_CONCURRENCY = 5;

/**
 * Bulk download endpoint for the Photo Library multi-select toolbar.
 *
 *   POST { photo_ids: string[] }  → streams a .zip of the selected photos
 *
 * Each image is fetched server-side at a web size (X-Large, falling back to
 * Large, then the stored Original) by rewriting the stored Original URL with
 * smugmugVariantUrl — so no SmugMug API call is needed. Images are prefetched
 * into buffers with bounded concurrency, then appended to the archive in order
 * and streamed back as an attachment. A single image that fails to fetch is
 * skipped (reported via the X-Zip-Skipped response header) rather than failing
 * the whole download.
 *
 * Auth: any signed-in user (the Photo Library is open to everyone).
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
  if (photoIds.length > MAX_SELECTION) {
    return NextResponse.json({ error: `Too many photos (max ${MAX_SELECTION})` }, { status: 400 });
  }

  const { data: rows, error } = await auth.supabase
    .from("photos")
    .select("id, image_url, smugmug_image_id")
    .in("id", photoIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "no photos found" }, { status: 404 });
  }

  type Row = { id: string; image_url: string | null; smugmug_image_id: string };

  // Prefetch into buffers up front (bounded concurrency) so we can count
  // failures before any response headers are sent, and so appending to the
  // archive can't race finalize().
  const fetched = await mapWithConcurrency(rows as Row[], FETCH_CONCURRENCY, async (row) => {
    const src = row.image_url
      ? smugmugVariantUrl(row.image_url, "XL") ??
        smugmugVariantUrl(row.image_url, "L") ??
        row.image_url
      : null;
    if (!src) return { row, buffer: null as Buffer | null, ext: "jpg" };
    try {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) return { row, buffer: null, ext: "jpg" };
      const ext = src.split("?")[0].split(".").pop() || "jpg";
      const buffer = Buffer.from(await res.arrayBuffer());
      return { row, buffer, ext };
    } catch {
      return { row, buffer: null, ext: "jpg" };
    }
  });

  const usable = fetched.filter((f): f is { row: Row; buffer: Buffer; ext: string } => f.buffer !== null);
  const skipped = fetched.length - usable.length;

  if (usable.length === 0) {
    return NextResponse.json({ error: "no images could be fetched" }, { status: 502 });
  }

  // Store (level 0) — JPEGs are already compressed, so compression buys almost
  // nothing and costs CPU/time.
  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.on("error", (err) => {
    // Surface as a stream error; the response body stream will abort.
    throw err;
  });
  for (const { row, buffer, ext } of usable) {
    // SmugMug image keys are unique, so filenames don't collide.
    archive.append(buffer, { name: `${row.smugmug_image_id}.${ext}` });
  }
  void archive.finalize();

  const stamp = new Date().toISOString().slice(0, 10);
  const headers = new Headers();
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="idtech-photos-${stamp}.zip"`);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Zip-Skipped", String(skipped));

  // archiver is a Node Readable; convert to a web stream for the Response body.
  const webStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, { status: 200, headers });
}
