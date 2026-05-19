import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 4, tags: 1 });

  // Pre-flag a couple of photos so senior_delete has a non-pending row
  // to act on, mirroring the natural workflow.
  const supabase = service();
  for (const photoId of fixture.photoIds.slice(0, 2)) {
    const { data: ev } = await supabase
      .from("triage_events")
      .insert({
        photo_id: photoId,
        reviewer_id: fixture.reviewer.id,
        kind: "flag",
        quarantine_intent: false,
      })
      .select("id")
      .single();
    if (ev?.id) {
      await supabase
        .from("triage_event_tags")
        .insert({ event_id: ev.id, tag_id: fixture.tagIds[0] });
    }
  }
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function postSenior(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/triage/events/senior/route");
  return POST(
    new Request("http://localhost/api/triage/events/senior", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/triage/events/senior", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postSenior({ photo_id: fixture.photoIds[0], kind: "senior_delete" });
    expect(res.status).toBe(401);
  });

  it("rejects reviewer role with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postSenior({ photo_id: fixture.photoIds[0], kind: "senior_delete" });
    expect(res.status).toBe(403);
  });

  it("rejects malformed body with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postSenior({ kind: "senior_delete" });
    expect(res.status).toBe(400);
  });

  it("senior_delete marks the photo deleted via trigger", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postSenior({ photo_id: fixture.photoIds[0], kind: "senior_delete" });
    expect(res.status).toBe(200);

    const { data } = await service()
      .from("photos")
      .select("triage_state")
      .eq("id", fixture.photoIds[0])
      .single();
    expect(data?.triage_state).toBe("deleted");
  });

  it("senior_quarantine flips is_quarantined to true", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postSenior({ photo_id: fixture.photoIds[1], kind: "senior_quarantine" });
    expect(res.status).toBe(200);

    const { data } = await service()
      .from("photos")
      .select("is_quarantined")
      .eq("id", fixture.photoIds[1])
      .single();
    expect(data?.is_quarantined).toBe(true);
  });

  it("senior_release_quarantine flips is_quarantined back to false", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postSenior({
      photo_id: fixture.photoIds[1],
      kind: "senior_release_quarantine",
    });
    expect(res.status).toBe(200);

    const { data } = await service()
      .from("photos")
      .select("is_quarantined")
      .eq("id", fixture.photoIds[1])
      .single();
    expect(data?.is_quarantined).toBe(false);
  });
});
