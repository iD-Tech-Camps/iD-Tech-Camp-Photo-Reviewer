import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 4, tags: 2 });
  const supabase = service();
  await supabase.from("tags").update({ purposes: ["photo_rating"] }).in("id", fixture.tagIds);
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function postEvent(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/photo-rating/events/route");
  return POST(
    new Request("http://localhost/api/photo-rating/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/photo-rating/events", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postEvent({ photo_id: fixture.photoIds[0], rating: 3 });
    expect(res.status).toBe(401);
  });

  it("rejects invalid rating with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({ photo_id: fixture.photoIds[0], rating: 0 });
    expect(res.status).toBe(400);
  });

  it("inserts rating event with optional tags", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({
      photo_id: fixture.photoIds[1],
      rating: 5,
      tag_ids: [fixture.tagIds[0]],
      quarantine_intent: false,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eventId).toBeTruthy();

    const { data } = await service()
      .from("photo_rating_events")
      .select("id, rating, photo_id")
      .eq("id", json.eventId)
      .single();
    expect(data?.rating).toBe(5);
    expect(data?.photo_id).toBe(fixture.photoIds[1]);

    const { data: tagRows } = await service()
      .from("photo_rating_event_tags")
      .select("tag_id")
      .eq("event_id", json.eventId);
    expect(tagRows?.map((r) => (r as { tag_id: string }).tag_id)).toEqual([fixture.tagIds[0]]);
  });
});
