import "../auth-mock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 4, tags: 2 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function postEvent(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/triage/events/route");
  return POST(
    new Request("http://localhost/api/triage/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/triage/events", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postEvent({ photo_id: fixture.photoIds[0], kind: "clean" });
    expect(res.status).toBe(401);
  });

  it("rejects unknown kind with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({ photo_id: fixture.photoIds[0], kind: "weird" });
    expect(res.status).toBe(400);
  });

  it("requires at least one tag when kind=flag", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({ photo_id: fixture.photoIds[0], kind: "flag", tag_ids: [] });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/at least one tag/i);
  });

  it("clean event inserts a triage_events row", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({ photo_id: fixture.photoIds[1], kind: "clean" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eventId).toBeTruthy();

    const { data } = await service()
      .from("triage_events")
      .select("id, kind, photo_id, reviewer_id")
      .eq("id", json.eventId)
      .single();
    expect(data?.kind).toBe("clean");
    expect(data?.photo_id).toBe(fixture.photoIds[1]);
    expect(data?.reviewer_id).toBe(fixture.reviewer.id);
  });

  it("flag event with tags inserts event + tag rows", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({
      photo_id: fixture.photoIds[2],
      kind: "flag",
      tag_ids: fixture.tagIds,
      quarantine_intent: false,
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    const { data: tags } = await service()
      .from("triage_event_tags")
      .select("tag_id")
      .eq("event_id", json.eventId);
    const got = (tags ?? []).map((r) => (r as { tag_id: string }).tag_id).sort();
    expect(got).toEqual([...fixture.tagIds].sort());
  });

  it("flag event with quarantine_intent sets is_quarantined on the photo via trigger", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({
      photo_id: fixture.photoIds[3],
      kind: "flag",
      tag_ids: [fixture.tagIds[0]],
      quarantine_intent: true,
    });
    expect(res.status).toBe(200);

    const { data: photo } = await service()
      .from("photos")
      .select("is_quarantined")
      .eq("id", fixture.photoIds[3])
      .single();
    expect(photo?.is_quarantined).toBe(true);
  });
});

describe("POST /api/triage/events — location-approval grace window", () => {
  let gracePhotoId: string;

  beforeEach(async () => {
    setMockAuth({ kind: "unauthenticated" });

    const supabase = service();

    // Clean approval rows + give the test a fresh pending photo each run.
    await supabase
      .from("location_approvals")
      .delete()
      .eq("location_id", fixture.locationId);

    const { data: newPhoto, error } = await supabase
      .from("photos")
      .insert({
        camp_week_id: fixture.campWeekId,
        smugmug_image_id: `${fixture.prefix}-grace-${Date.now()}-${Math.random()}`,
      })
      .select("id")
      .single();
    if (error || !newPhoto) throw new Error(`grace photo seed: ${error?.message ?? "no row"}`);
    gracePhotoId = newPhoto.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    const supabase = service();
    await supabase
      .from("location_approvals")
      .delete()
      .eq("location_id", fixture.locationId);
    await supabase.from("photos").delete().eq("id", gracePhotoId);
  });

  it("accepts an event inside the 60s window with location_approved_during_batch=true", async () => {
    const supabase = service();
    const { data: approval } = await supabase
      .from("location_approvals")
      .insert({
        location_id: fixture.locationId,
        season_start: "2026-05-24",
        approved_by: fixture.senior.id,
      })
      .select("approved_at")
      .single();
    expect(approval?.approved_at).toBeTruthy();

    // Pin "now" to 30s after the approval — well within the 60s window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(new Date(approval!.approved_at).getTime() + 30_000));

    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({ photo_id: gracePhotoId, kind: "clean" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eventId).toBeTruthy();
    expect(json.location_approved_during_batch).toBe(true);
  });

  it("rejects an event past the 60s window with 410", async () => {
    const supabase = service();
    const { data: approval } = await supabase
      .from("location_approvals")
      .insert({
        location_id: fixture.locationId,
        season_start: "2026-05-24",
        approved_by: fixture.senior.id,
      })
      .select("approved_at")
      .single();
    expect(approval?.approved_at).toBeTruthy();

    // 90s past approval — outside the grace window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(new Date(approval!.approved_at).getTime() + 90_000));

    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postEvent({ photo_id: gracePhotoId, kind: "clean" });
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error).toBe("location_approved");
  });
});
