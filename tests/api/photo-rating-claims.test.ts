import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 6, tags: 0 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function postClaim(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/photo-rating/claims/route");
  return POST(
    new Request("http://localhost/api/photo-rating/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/photo-rating/claims", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postClaim({ camp_week_id: fixture.campWeekId, slice_size: 3 });
    expect(res.status).toBe(401);
  });

  it("creates a claim and stamps photos in_progress", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postClaim({ camp_week_id: fixture.campWeekId, slice_size: 3 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.claim?.id).toBeTruthy();

    const { count } = await service()
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("rating_claim_id", json.claim.id)
      .eq("rating_state", "in_progress");
    expect(count).toBe(3);
  });
});
