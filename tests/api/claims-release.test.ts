import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 4 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function createClaim(reviewerId: string): Promise<string> {
  const { data, error } = await service()
    .from("triage_claims")
    .insert({ camp_week_id: fixture.campWeekId, reviewer_id: reviewerId, slice_size: 1 })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createClaim: ${error?.message}`);
  return data.id;
}

async function release(id: string): Promise<Response> {
  const { POST } = await import("@/app/api/triage/claims/[id]/release/route");
  return POST(new Request(`http://localhost/api/triage/claims/${id}/release`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/triage/claims/[id]/release", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await release("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the claim id is unknown but auth is valid", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await release("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("releases when caller owns the claim", async () => {
    const claimId = await createClaim(fixture.reviewer.id);
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });

    const res = await release(claimId);
    expect(res.status).toBe(200);

    const { data } = await service()
      .from("triage_claims")
      .select("released_at, release_reason")
      .eq("id", claimId)
      .single();
    expect(data?.released_at).toBeTruthy();
    expect(data?.release_reason).toBe("explicit");

    await service().from("triage_claims").delete().eq("id", claimId);
  });

  it("rejects a non-owner non-admin caller with 403", async () => {
    const claimId = await createClaim(fixture.reviewer.id);
    // Senior who is neither the owner nor an admin must not release.
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });

    const res = await release(claimId);
    expect(res.status).toBe(403);

    await service().from("triage_claims").delete().eq("id", claimId);
  });

  it("admin force-release stamps admin_force reason", async () => {
    const claimId = await createClaim(fixture.reviewer.id);
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });

    const res = await release(claimId);
    expect(res.status).toBe(200);

    const { data } = await service()
      .from("triage_claims")
      .select("release_reason")
      .eq("id", claimId)
      .single();
    expect(data?.release_reason).toBe("admin_force");

    await service().from("triage_claims").delete().eq("id", claimId);
  });
});
