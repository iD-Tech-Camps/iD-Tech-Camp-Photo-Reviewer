import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 1, tags: 1 });
});

afterAll(async () => {
  // Restore the seeded default so subsequent test files (and dev) see a
  // sensible value.
  await service()
    .from("points_rules")
    .update({ points: 1 })
    .eq("source_kind", "triage_event");
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function putRule(body: unknown): Promise<Response> {
  const { PUT } = await import("@/app/api/admin/points-rules/route");
  return PUT(
    new Request("http://localhost/api/admin/points-rules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("PUT /api/admin/points-rules", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await putRule({ source_kind: "triage_event", points: 2 });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin callers with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await putRule({ source_kind: "triage_event", points: 2 });
    expect(res.status).toBe(403);
  });

  it("rejects unknown source_kind with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const res = await putRule({ source_kind: "made_up", points: 2 });
    expect(res.status).toBe(400);
  });

  it("rejects negative points with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const res = await putRule({ source_kind: "triage_event", points: -1 });
    expect(res.status).toBe(400);
  });

  it("rejects non-integer points with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const res = await putRule({ source_kind: "triage_event", points: 1.5 });
    expect(res.status).toBe(400);
  });

  it("admin update persists and bumps updated_at", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const before = await service()
      .from("points_rules")
      .select("updated_at")
      .eq("source_kind", "triage_event")
      .single();

    const res = await putRule({ source_kind: "triage_event", points: 7 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.points).toBe(7);
    expect(json.source_kind).toBe("triage_event");

    const after = await service()
      .from("points_rules")
      .select("points, updated_at")
      .eq("source_kind", "triage_event")
      .single();
    expect(after.data?.points).toBe(7);
    expect(new Date(after.data!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.data!.updated_at).getTime(),
    );
  });

  it("triage_events trigger awards points snapshotted from the rule", async () => {
    // Lock the rule to 4 for this check.
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const res = await putRule({ source_kind: "triage_event", points: 4 });
    expect(res.status).toBe(200);

    // Insert a clean event via service role (matches the production path —
    // the API route uses the user-scoped client, but RLS just gates the
    // insert; the trigger fires identically).
    const { data: event, error } = await service()
      .from("triage_events")
      .insert({
        photo_id: fixture.photoIds[0],
        reviewer_id: fixture.reviewer.id,
        kind: "clean",
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const { data: ledger } = await service()
      .from("points_ledger")
      .select("user_id, points, source_kind, source_id")
      .eq("source_id", event!.id)
      .single();
    expect(ledger?.user_id).toBe(fixture.reviewer.id);
    expect(ledger?.points).toBe(4);
    expect(ledger?.source_kind).toBe("triage_event");

    // Cleanup so the fixture teardown's photo delete cascades cleanly.
    await service().from("points_ledger").delete().eq("source_id", event!.id);
    await service().from("triage_events").delete().eq("id", event!.id);
  });
});
