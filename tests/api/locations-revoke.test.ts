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

async function postApprove(locationId: string): Promise<Response> {
  const { POST } = await import("@/app/api/locations/[id]/approve/route");
  return POST(
    new Request(`http://localhost/api/locations/${locationId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ id: locationId }) },
  );
}

async function postRevoke(locationId: string, body: unknown = {}): Promise<Response> {
  const { POST } = await import("@/app/api/locations/[id]/revoke/route");
  return POST(
    new Request(`http://localhost/api/locations/${locationId}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: locationId }) },
  );
}

describe("POST /api/locations/[id]/revoke", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postRevoke(fixture.locationId);
    expect(res.status).toBe(401);
  });

  it("rejects reviewer role with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postRevoke(fixture.locationId);
    expect(res.status).toBe(403);
  });

  it("returns 404 when there is no active approval to revoke", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });
    const res = await postRevoke(fixture.locationId);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("not_approved");
  });

  it("revokes the approval and reopens drained photos", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    const approve = await postApprove(fixture.locationId);
    expect(approve.status).toBe(200);

    const supabase = service();
    const { count: notReqAfterApprove } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("camp_week_id", fixture.campWeekId)
      .eq("triage_state", "not_required");
    expect(notReqAfterApprove).toBe(3);

    const revoke = await postRevoke(fixture.locationId, { reason: "test" });
    expect(revoke.status).toBe(200);
    const json = await revoke.json();
    expect(json.approval?.revoked_at).toBeTruthy();
    expect(json.approval?.revoked_by).toBe(fixture.senior.id);
    expect(json.approval?.revocation_reason).toBe("test");

    const { count: pendingAfterRevoke } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("camp_week_id", fixture.campWeekId)
      .eq("triage_state", "pending");
    expect(pendingAfterRevoke).toBe(3);
  });

  it("released-by-approve claims stay released across revoke", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

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

    await postApprove(fixture.locationId);

    const { data: afterApprove } = await supabase
      .from("triage_claims")
      .select("released_at, release_reason")
      .eq("id", claim!.id)
      .single();
    const approvedReleasedAt = afterApprove?.released_at;

    await postRevoke(fixture.locationId);

    const { data: afterRevoke } = await supabase
      .from("triage_claims")
      .select("released_at, release_reason")
      .eq("id", claim!.id)
      .single();
    expect(afterRevoke?.released_at).toBe(approvedReleasedAt);
    expect(afterRevoke?.release_reason).toBe("location_approved");
  });
});
