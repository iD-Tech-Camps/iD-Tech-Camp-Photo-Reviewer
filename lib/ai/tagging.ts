import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";
import { describePhoto, embedImage, embedTexts } from "@/lib/ai/gemini";
import { buildSearchDocument, toMetadataRow, type PhotoContext } from "@/lib/ai/photo-metadata";

type PendingRow = {
  photo_id: string;
  image_url: string | null;
  thumbnail_url: string | null;
  attempts: number;
  week_name: string | null;
  starts_on: string | null;
  location_name: string | null;
  division_name: string | null;
};

export type SweepOptions = {
  /** Max photos to pull from the queue this run. */
  limit: number;
  /** Photos processed in parallel. */
  concurrency: number;
  /** Stop starting new photos after this many ms (leave headroom for maxDuration). */
  budgetMs: number;
};

export type SweepResult = {
  picked: number;
  tagged: number;
  failed: number;
  skippedForTime: number;
  ms: number;
  errors: { photoId: string; error: string }[];
};

/**
 * SmugMug "M" (~140 KB) is plenty for description and keeps token + transfer
 * cost down. Falls back to whatever URL we have if it isn't rewritable.
 */
export function taggingImageUrl(row: { image_url: string | null; thumbnail_url: string | null }): string | null {
  for (const url of [row.image_url, row.thumbnail_url]) {
    if (!url) continue;
    const m = smugmugVariantUrl(url, "M");
    if (m) return m;
  }
  return row.image_url ?? row.thumbnail_url;
}

async function fetchImage(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error(`not an image: ${mimeType}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType };
}

/** Describe + embed one photo and upsert its metadata row. */
export async function tagPhoto(service: SupabaseClient, row: PendingRow): Promise<void> {
  const url = taggingImageUrl(row);
  if (!url) throw new Error("photo has no image url");
  const ctx: PhotoContext = { divisionName: row.division_name, locationName: row.location_name, weekName: row.week_name };

  const { bytes, mimeType } = await fetchImage(url);
  const { metadata, model } = await describePhoto(bytes, mimeType, ctx);
  const [[textEmbedding], imageEmbedding] = await Promise.all([
    embedTexts([buildSearchDocument(metadata, ctx)], "RETRIEVAL_DOCUMENT"),
    // Image embedding is a bonus signal; don't fail the photo over it.
    embedImage(bytes, mimeType).catch(() => null),
  ]);

  const { error } = await service
    .from("photo_ai_metadata")
    .upsert({ ...toMetadataRow(row.photo_id, metadata, { model, textEmbedding, imageEmbedding }), attempts: row.attempts + 1 });
  if (error) throw new Error(`upsert: ${error.message}`);
}

async function recordFailure(service: SupabaseClient, row: PendingRow, message: string) {
  await service.from("photo_ai_metadata").upsert({
    photo_id: row.photo_id,
    status: "failed",
    attempts: row.attempts + 1,
    last_error: message.slice(0, 1000),
    updated_at: new Date().toISOString(),
  });
}

/**
 * Pull pending photos and tag them until the queue slice or time budget runs
 * out. Safe to run concurrently with itself: rows are upserted by photo_id,
 * so an overlap only wastes a little work.
 */
export async function runTaggingSweep(service: SupabaseClient, opts: SweepOptions): Promise<SweepResult> {
  const start = Date.now();
  const { data, error } = await service.rpc("photo_ai_pending", { p_limit: opts.limit });
  if (error) throw new Error(`photo_ai_pending: ${error.message}`);
  const queue = (data ?? []) as PendingRow[];

  const result: SweepResult = { picked: queue.length, tagged: 0, failed: 0, skippedForTime: 0, ms: 0, errors: [] };
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      if (Date.now() - start > opts.budgetMs) {
        result.skippedForTime = queue.length - next;
        next = queue.length;
        return;
      }
      const row = queue[next++];
      try {
        await tagPhoto(service, row);
        result.tagged++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.failed++;
        if (result.errors.length < 20) result.errors.push({ photoId: row.photo_id, error: message });
        await recordFailure(service, row, message).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  result.ms = Date.now() - start;
  return result;
}
