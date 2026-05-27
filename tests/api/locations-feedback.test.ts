import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 1, tags: 2 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(async () => {
  setMockAuth({ kind: "unauthenticated" });

  const supabase = service();
  // Reset feedback rows for this location each test.
  await supabase
    .from("location_feedback_events")
    .delete()
    .eq("location_id", fixture.locationId);
});

async function postFeedback(locationId: string, body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/locations/[id]/feedback/route");
  return POST(
    new Request(`http://localhost/api/locations/${locationId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: locationId }) },
  );
}

async function getFeedback(locationId: string): Promise<Response> {
  const { GET } = await import("@/app/api/locations/[id]/feedback/route");
  return GET(
    new Request(`http://localhost/api/locations/${locationId}/feedback`),
    { params: Promise.resolve({ id: locationId }) },
  );
}

describe("POST /api/locations/[id]/feedback", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postFeedback(fixture.locationId, { body: "hello" });
    expect(res.status).toBe(401);
  });

  it("rejects reviewer role with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postFeedback(fixture.locationId, { body: "hello" });
    expect(res.status).toBe(403);
  });

  it("rejects empty body with 400", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });
    const res = await postFeedback(fixture.locationId, { body: "   " });
    expect(res.status).toBe(400);
  });

  it("creates a feedback event and persists optional tags", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    const res = await postFeedback(fixture.locationId, {
      body: "Lab looks good; check the back camera angle.",
      camp_week_id: fixture.campWeekId,
      tag_ids: fixture.tagIds,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.event?.body).toMatch(/back camera/);
    expect(json.event?.camp_week_id).toBe(fixture.campWeekId);

    const supabase = service();
    const { data: tagRows } = await supabase
      .from("location_feedback_event_tags")
      .select("tag_id")
      .eq("event_id", json.event.id);
    const tagIds = (tagRows ?? []).map((r) => r.tag_id).sort();
    expect(tagIds).toEqual([...fixture.tagIds].sort());
  });
});

describe("GET /api/locations/[id]/feedback", () => {
  it("returns the location's feedback events newest first", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    await postFeedback(fixture.locationId, { body: "first" });
    await postFeedback(fixture.locationId, { body: "second" });

    // Reviewer can read feedback too.
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await getFeedback(fixture.locationId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.events).toHaveLength(2);
    expect(json.events[0].body).toBe("second");
    expect(json.events[1].body).toBe("first");
  });
});
