import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { seed, service, teardown, type Fixture } from "../fixtures";
import { fetchRatedPhotos } from "@/lib/photo-gallery";

// Photos in the fixture pool. Has to exceed the number of UUIDs that fit in a
// PostgREST `.in()` URL (a couple hundred on the local stack, ~660 behind the
// hosted edge proxy) — that ceiling is what the tag filter used to hit, and a
// pool this size is what a real program tag like "CrunchLabs" looks like.
const POOL = 400;

let fixture: Fixture;
let taggedIds: string[];
// Photos each fixture user has a rating event for. The two sets overlap on the
// re-rated photos, which both users have an event for.
let reviewerPhotoIds: Set<string>;
let seniorPhotoIds: Set<string>;

beforeAll(async () => {
  fixture = await seed({ photos: POOL, tags: 2 });
  const supabase = service();

  // Rate every photo (the trigger stamps rating_state + current_rating), then
  // tag the first tag onto all of them and the second onto only three.
  const events = fixture.photoIds.map((photoId, i) => ({
    id: randomUUID(),
    photo_id: photoId,
    reviewer_id: i % 2 === 0 ? fixture.reviewer.id : fixture.senior.id,
    rating: 4,
  }));
  const { error: evErr } = await supabase.from("photo_rating_events").insert(events);
  if (evErr) throw new Error(`seed rating events: ${evErr.message}`);

  // Re-rate the first five photos, tagged the same way, so the tag filter's
  // join has two matching events for one photo — a fan-out that would show up
  // as duplicate tiles in the grid.
  const rerates = fixture.photoIds.slice(0, 5).map((photoId) => ({
    id: randomUUID(),
    photo_id: photoId,
    reviewer_id: fixture.senior.id,
    rating: 5,
  }));
  const { error: reErr } = await supabase.from("photo_rating_events").insert(rerates);
  if (reErr) throw new Error(`seed re-rate events: ${reErr.message}`);

  const tagRows = [
    ...[...events, ...rerates].map((e) => ({ event_id: e.id, tag_id: fixture.tagIds[0] })),
    ...events.slice(0, 3).map((e) => ({ event_id: e.id, tag_id: fixture.tagIds[1] })),
  ];
  const { error: tagErr } = await supabase.from("photo_rating_event_tags").insert(tagRows);
  if (tagErr) throw new Error(`seed event tags: ${tagErr.message}`);

  taggedIds = fixture.photoIds;
  const photoIdsRatedBy = (id: string) =>
    new Set([...events, ...rerates].filter((e) => e.reviewer_id === id).map((e) => e.photo_id));
  reviewerPhotoIds = photoIdsRatedBy(fixture.reviewer.id);
  seniorPhotoIds = photoIdsRatedBy(fixture.senior.id);
});

afterAll(async () => {
  await teardown(fixture);
});

describe("fetchRatedPhotos tag filter", () => {
  it("filters a tag carried by more photos than fit in an `.in()` URL", async () => {
    const rows = await fetchRatedPhotos(service(), {
      campWeekId: fixture.campWeekId,
      tagIds: [fixture.tagIds[0]],
      minRating: 3,
      sort: "rating_desc",
      offset: 0,
      limit: 60,
    });
    expect(rows).toHaveLength(60);
    const ids = new Set(taggedIds);
    for (const r of rows) expect(ids.has(r.id)).toBe(true);
  });

  it("paginates a large tag result without repeating photos", async () => {
    const common = {
      campWeekId: fixture.campWeekId,
      tagIds: [fixture.tagIds[0]],
      minRating: 3,
      sort: "rating_desc" as const,
      limit: 60,
    };
    const page0 = await fetchRatedPhotos(service(), { ...common, offset: 0 });
    const page1 = await fetchRatedPhotos(service(), { ...common, offset: 60 });
    expect(page1).toHaveLength(60);
    const seen = new Set(page0.map((p) => p.id));
    for (const p of page1) expect(seen.has(p.id)).toBe(false);
  });

  it("returns a re-rated photo once, not once per matching event", async () => {
    const rows = await fetchRatedPhotos(service(), {
      campWeekId: fixture.campWeekId,
      tagIds: [fixture.tagIds[0]],
      minRating: 5,
      sort: "rating_desc",
      offset: 0,
      limit: 60,
    });
    // The five re-rated photos are the only 5★ rows in the pool.
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.id)).size).toBe(5);
  });

  it("returns only the photos carrying a narrow tag", async () => {
    const rows = await fetchRatedPhotos(service(), {
      campWeekId: fixture.campWeekId,
      tagIds: [fixture.tagIds[1]],
      minRating: 3,
      sort: "rating_desc",
      offset: 0,
      limit: 60,
    });
    expect(rows).toHaveLength(3);
  });

  it("intersects a large tag with `only my ratings`", async () => {
    const rows = await fetchRatedPhotos(service(), {
      campWeekId: fixture.campWeekId,
      tagIds: [fixture.tagIds[0]],
      mineOnly: true,
      viewerId: fixture.reviewer.id,
      minRating: 3,
      sort: "rating_desc",
      offset: 0,
      limit: 60,
    });
    expect(rows).toHaveLength(60);
    // "Only my ratings" matches superseded events too, so a photo the reviewer
    // rated and the senior later re-rated still belongs on this page — it is
    // just attributed to the senior in the grid.
    for (const r of rows) expect(reviewerPhotoIds.has(r.id)).toBe(true);
  });

  it("filters by `only my ratings` alone across a large pool", async () => {
    const rows = await fetchRatedPhotos(service(), {
      campWeekId: fixture.campWeekId,
      mineOnly: true,
      viewerId: fixture.senior.id,
      minRating: 3,
      sort: "rating_desc",
      offset: 0,
      limit: 60,
    });
    expect(rows).toHaveLength(60);
    for (const r of rows) expect(seniorPhotoIds.has(r.id)).toBe(true);
  });
});
