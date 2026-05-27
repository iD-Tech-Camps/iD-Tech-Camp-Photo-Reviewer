import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 3 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(async () => {
  setMockAuth({ kind: "unauthenticated" });

  // Reset between tests: clear any approval rows for the fixture location,
  // and reset photos to their post-seed state (pending).
  const supabase = service();
  await supabase.from("location_approvals").delete().eq("location_id", fixture.locationId);
  await supabase
    .from("photos")
    .update({ triage_state: "pending", triage_claim_id: null })
    .eq("camp_week_id", fixture.campWeekId);
  await supabase
    .from("triage_claims")
    .delete()
    .eq("camp_week_id", fixture.campWeekId);
});

async function postApprove(locationId: string, body: unknown = {}): Promise<Response> {
  const { POST } = await import("@/app/api/locations/[id]/approve/route");
  return POST(
    new Request(`http://localhost/api/locations/${locationId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: locationId }) },
  );
}

describe("POST /api/locations/[id]/approve", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postApprove(fixture.locationId);
    expect(res.status).toBe(401);
  });

  it("rejects reviewer role with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postApprove(fixture.locationId);
    expect(res.status).toBe(403);
  });

  it("approves the location and drains pending photos", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    const before = await service()
      .from("photos")
      .select("id, triage_state")
      .eq("camp_week_id", fixture.campWeekId);
    expect(before.data?.every((p) => p.triage_state === "pending")).toBe(true);

    const res = await postApprove(fixture.locationId);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approval?.location_id).toBe(fixture.locationId);
    expect(json.approval?.approved_by).toBe(fixture.senior.id);
    expect(json.approval?.revoked_at).toBeNull();

    const after = await service()
      .from("photos")
      .select("id, triage_state")
      .eq("camp_week_id", fixture.campWeekId);
    expect(after.data?.every((p) => p.triage_state === "not_required")).toBe(true);
  });

  it("drains an active claim with release_reason=location_approved", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    // Seed an active claim that stamps a photo in_progress.
    const supabase = service();
    const { data: claim } = await supabase
      .from("triage_claims")
      .insert({
        camp_week_id: fixture.campWeekId,
        reviewer_id: fixture.reviewer.id,
        slice_size: 1,
      })
      .select("id")
      .single();
    expect(claim?.id).toBeTruthy();

    const { count: inProgressBefore } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("camp_week_id", fixture.campWeekId)
      .eq("triage_state", "in_progress");
    expect(inProgressBefore).toBe(1);

    const res = await postApprove(fixture.locationId);
    expect(res.status).toBe(200);

    const { data: claimAfter } = await supabase
      .from("triage_claims")
      .select("released_at, release_reason")
      .eq("id", claim!.id)
      .single();
    expect(claimAfter?.released_at).toBeTruthy();
    expect(claimAfter?.release_reason).toBe("location_approved");

    const { count: pendingAfter } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("camp_week_id", fixture.campWeekId)
      .in("triage_state", ["pending", "in_progress"]);
    expect(pendingAfter).toBe(0);
  });

  it("returns 409 on concurrent re-approve", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    const first = await postApprove(fixture.locationId);
    expect(first.status).toBe(200);

    const second = await postApprove(fixture.locationId);
    expect(second.status).toBe(409);
    const json = await second.json();
    expect(json.error).toBe("already_approved");
  });
});
