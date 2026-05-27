import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 2, tags: 1 });

  const supabase = service();

  // Claim + clean every photo so the week recomputes to triage_done. The new
  // shim doesn't require the week to be in triage_done (it writes the
  // location-level approval regardless), but doing this keeps the signoff_at
  // dual-write assertion meaningful since the legacy column write only
  // succeeds when signoff_at is null.
  const { error: claimErr } = await supabase.from("triage_claims").insert({
    camp_week_id: fixture.campWeekId,
    reviewer_id: fixture.reviewer.id,
    slice_size: fixture.photoIds.length,
  });
  if (claimErr) throw new Error(`seed triage_claim: ${claimErr.message}`);

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

describe("POST /api/triage/signoff (dual-write shim)", () => {
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

  it("dual-writes location_approvals + legacy signoff columns", async () => {
    setMockAuth({
      kind: "user",
      userId: fixture.senior.id,
      role: "senior",
      email: fixture.senior.email,
    });

    const res = await postSignoff({
      camp_week_id: fixture.campWeekId,
      flag_second_week_recheck: false,
    });
    expect(res.status).toBe(200);

    const supabase = service();

    // 1. Legacy: camp_weeks.signoff_at / signoff_by populated.
    const { data: week } = await supabase
      .from("camp_weeks")
      .select("signoff_by, signoff_at")
      .eq("id", fixture.campWeekId)
      .single();
    expect(week?.signoff_by).toBe(fixture.senior.id);
    expect(week?.signoff_at).toBeTruthy();

    // 2. New model: a location_approvals row exists for this location.
    const { data: approval } = await supabase
      .from("location_approvals")
      .select("location_id, approved_by, revoked_at")
      .eq("location_id", fixture.locationId)
      .is("revoked_at", null)
      .single();
    expect(approval?.location_id).toBe(fixture.locationId);
    expect(approval?.approved_by).toBe(fixture.senior.id);
    expect(approval?.revoked_at).toBeNull();
  });
});
