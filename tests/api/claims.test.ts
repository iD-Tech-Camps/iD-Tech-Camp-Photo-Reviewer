import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 6 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function postClaims(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/triage/claims/route");
  return POST(
    new Request("http://localhost/api/triage/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/triage/claims", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postClaims({ camp_week_id: fixture.campWeekId, slice_size: 2 });
    expect(res.status).toBe(401);
  });

  it("rejects malformed body with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postClaims({ camp_week_id: fixture.campWeekId });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("creates a claim and returns its id on happy path", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postClaims({ camp_week_id: fixture.campWeekId, slice_size: 2 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claim?.id).toBeTruthy();
    expect(json.claim?.slice_size).toBe(2);

    await service().from("triage_claims").delete().eq("id", json.claim.id);
  });

  it("enforces 3-active-claim cap with 409", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });

    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await postClaims({ camp_week_id: fixture.campWeekId, slice_size: 1 });
      expect(res.status).toBe(200);
      const json = await res.json();
      created.push(json.claim.id);
    }

    const fourth = await postClaims({ camp_week_id: fixture.campWeekId, slice_size: 1 });
    expect(fourth.status).toBe(409);
    const json = await fourth.json();
    expect(json.error).toMatch(/maximum/i);

    await service().from("triage_claims").delete().in("id", created);
  });
});
