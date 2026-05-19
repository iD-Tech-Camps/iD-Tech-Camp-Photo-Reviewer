import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 2, tags: 1 });

  // Mark every photo clean so the week is `triage_done` and ready for
  // signoff. The check constraint forbids quarantine_intent=true on
  // clean events; leave it false.
  const supabase = service();
  for (const photoId of fixture.photoIds) {
    await supabase.from("triage_events").insert({
      photo_id: photoId,
      reviewer_id: fixture.reviewer.id,
      kind: "clean",
      quarantine_intent: false,
    });
  }
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function postSignoff(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/triage/signoff/route");
  return POST(
    new Request("http://localhost/api/triage/signoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/triage/signoff", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postSignoff({ camp_week_id: fixture.campWeekId });
    expect(res.status).toBe(401);
  });

  it("rejects reviewer role with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postSignoff({ camp_week_id: fixture.campWeekId });
    expect(res.status).toBe(403);
  });

  it("rejects missing camp_week_id with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postSignoff({});
    expect(res.status).toBe(400);
  });

  it("signoff sets the week to complete", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postSignoff({
      camp_week_id: fixture.campWeekId,
      flag_second_week_recheck: false,
    });
    expect(res.status).toBe(200);

    const { data } = await service()
      .from("camp_weeks")
      .select("triage_state, signoff_by, signoff_at")
      .eq("id", fixture.campWeekId)
      .single();
    expect(data?.triage_state).toBe("complete");
    expect(data?.signoff_by).toBe(fixture.senior.id);
    expect(data?.signoff_at).toBeTruthy();
  });
});
