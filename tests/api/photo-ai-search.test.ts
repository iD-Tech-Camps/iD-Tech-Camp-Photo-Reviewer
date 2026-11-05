import "../auth-mock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { authedClientFor, seed, service, teardown, type Fixture } from "../fixtures";

// Contract tests for migration 20261105000054: the tagging work queue
// (photo_ai_pending), hybrid search (photo_ai_search) and the sweep route's
// guards. Uses synthetic embeddings, so no Gemini calls are made.

const DIMS = 768;
const basis = (i: number, mix?: [number, number]) => {
  const v = new Array(DIMS).fill(0);
  v[i] = 1;
  if (mix) v[mix[0]] = mix[1];
  return `[${v.join(",")}]`;
};

let f: Fixture;
let robotsGirls: string, frisbeeBoys: string, failedPhoto: string, quarantined: string, untagged: string;

function meta(photoId: string, over: Record<string, unknown>) {
  return {
    photo_id: photoId,
    status: "done",
    caption: "campers in a classroom",
    people_count_bucket: "3-5",
    girls: 0, boys: 0, women: 0, men: 0, gender_unclear: 0,
    shot_type: "medium",
    photo_quality: "good",
    keywords: [],
    model: "test",
    prompt_version: 2,
    ...over,
  };
}

beforeAll(async () => {
  f = await seed({ photos: 5 });
  [robotsGirls, frisbeeBoys, failedPhoto, quarantined, untagged] = f.photoIds;
  const svc = service();

  // Far-future capture dates put these at the head of the newest-first queue
  // regardless of other data in the local DB.
  for (const [i, id] of f.photoIds.entries()) {
    const { error } = await svc.from("photos").update({
      image_url: `https://photos.smugmug.com/x/i-abc${i}/0/H/D/IMG_${i}-D.jpg`,
      captured_at: new Date(Date.UTC(2099, 0, 1, i)).toISOString(),
      is_quarantined: id === quarantined,
    }).eq("id", id);
    if (error) throw error;
  }

  const { error } = await svc.from("photo_ai_metadata").insert([
    meta(robotsGirls, {
      caption: "Two girls build a VEX robot together",
      people_count_bucket: "2", girls: 2,
      keywords: ["robot", "robotics", "VEX"],
      text_embedding: basis(0), image_embedding: basis(0, [1, 0.2]),
    }),
    meta(frisbeeBoys, {
      caption: "Three boys play frisbee on the lawn",
      girls: 0, boys: 3, shot_type: "wide",
      keywords: ["frisbee", "outdoors"],
      text_embedding: basis(1), image_embedding: basis(1),
    }),
    meta(quarantined, { caption: "robot", text_embedding: basis(0), image_embedding: basis(0) }),
  ]);
  if (error) throw error;
  // Separate insert: a multi-row insert would null out the columns this
  // sparse row omits (including NOT NULL array defaults).
  const { error: failErr } = await svc.from("photo_ai_metadata").insert(
    { photo_id: failedPhoto, status: "failed", attempts: 1, last_error: "boom", updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
  );
  if (failErr) throw failErr;
});

afterAll(async () => {
  await teardown(f); // photo_ai_metadata rows cascade with the photos
});

const search = (args: Record<string, unknown>) =>
  service().rpc("photo_ai_search", { p_embedding: basis(0), p_location_id: f.locationId, ...args });

describe("photo_ai_pending", () => {
  it("queues untagged photos and due retries, skipping tagged and quarantined", async () => {
    const { data, error } = await service().rpc("photo_ai_pending", { p_limit: 500 });
    expect(error).toBeNull();
    const ids = (data as { photo_id: string }[]).map((r) => r.photo_id);
    expect(ids).toContain(untagged);
    expect(ids).toContain(failedPhoto); // failed 2h ago, 1 attempt -> due
    expect(ids).not.toContain(robotsGirls);
    expect(ids).not.toContain(quarantined);
    const row = (data as { photo_id: string; attempts: number; location_name: string }[]).find((r) => r.photo_id === failedPhoto)!;
    expect(row.attempts).toBe(1);
    expect(row.location_name).toBe(`${f.prefix}-loc`);
  });

  it("stops retrying after 3 attempts", async () => {
    await service().from("photo_ai_metadata").update({ attempts: 3 }).eq("photo_id", failedPhoto);
    const { data } = await service().rpc("photo_ai_pending", { p_limit: 500 });
    expect((data as { photo_id: string }[]).map((r) => r.photo_id)).not.toContain(failedPhoto);
  });

  it("exposes nothing to anonymous callers (runs under the caller's RLS)", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const pending = await anon.rpc("photo_ai_pending", { p_limit: 500 });
    expect(pending.data ?? []).toEqual([]);
    const found = await anon.rpc("photo_ai_search", { p_embedding: basis(0), p_location_id: f.locationId });
    expect(found.data ?? []).toEqual([]);
  });
});

describe("photo_ai_search", () => {
  it("ranks the closest embedding first and excludes failed + quarantined photos", async () => {
    const { data, error } = await search({});
    expect(error).toBeNull();
    const ids = (data as { photo_id: string }[]).map((r) => r.photo_id);
    expect(ids[0]).toBe(robotsGirls);
    expect(ids).not.toContain(quarantined);
    expect(ids).not.toContain(failedPhoto);
    expect(ids).toContain(frisbeeBoys); // still returned, just ranked lower
  });

  it("applies structured filters (gender minimums, people, shot type)", async () => {
    const girls = await search({ p_min_girls: 1 });
    expect((girls.data as { photo_id: string }[]).map((r) => r.photo_id)).toEqual([robotsGirls]);
    const wide = await search({ p_shot_types: ["wide"] });
    expect((wide.data as { photo_id: string }[]).map((r) => r.photo_id)).toEqual([frisbeeBoys]);
    const two = await search({ p_people: ["2"] });
    expect((two.data as { photo_id: string }[]).map((r) => r.photo_id)).toEqual([robotsGirls]);
  });

  it("lets keyword matches lift a photo the embedding ranks lower", async () => {
    const { data } = await search({ p_query: "frisbee" });
    const rows = data as { photo_id: string; keyword_match: boolean }[];
    expect(rows.find((r) => r.photo_id === frisbeeBoys)?.keyword_match).toBe(true);
    expect(rows.find((r) => r.photo_id === robotsGirls)?.keyword_match).toBe(false);
  });

  it("drops results under p_min_similarity and returns similarities", async () => {
    const { data } = await search({ p_min_similarity: 0.9 });
    const rows = data as { photo_id: string; text_similarity: number }[];
    expect(rows.map((r) => r.photo_id)).toEqual([robotsGirls]);
    expect(rows[0].text_similarity).toBeCloseTo(1, 5);
  });

  it("is callable by a signed-in reviewer (RLS read access)", async () => {
    const client = await authedClientFor(f.reviewer.email);
    const { data, error } = await client.rpc("photo_ai_search", { p_embedding: basis(0), p_location_id: f.locationId });
    expect(error).toBeNull();
    expect((data as { photo_id: string }[])[0]?.photo_id).toBe(robotsGirls);
  });
});

describe("GET /api/ai-tagging/sweep", () => {
  const call = async (headers: Record<string, string> = {}) => {
    const { GET } = await import("@/app/api/ai-tagging/sweep/route");
    return GET(new Request("http://localhost/api/ai-tagging/sweep", { headers }));
  };

  it("rejects callers without CRON_SECRET", async () => {
    expect((await call()).status).toBe(401);
  });

  it("is a no-op unless AI_TAGGING_ENABLED=true", async () => {
    const prev = process.env.AI_TAGGING_ENABLED;
    delete process.env.AI_TAGGING_ENABLED;
    try {
      const res = await call({ authorization: `Bearer ${process.env.CRON_SECRET}` });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ skipped: expect.any(String) });
    } finally {
      if (prev !== undefined) process.env.AI_TAGGING_ENABLED = prev;
    }
  });
});
