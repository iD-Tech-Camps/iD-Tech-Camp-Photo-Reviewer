import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

// Mock the SmugMug-side reconcile so the suite stays hermetic (no OAuth /
// network). The routes still perform the real DB flip; we assert that and that
// reconcile is invoked once per updated photo. mapWithConcurrency (used by the
// bulk route) is left real — it just drives this spy.
const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/smugmug/sync/quarantine", () => ({
  runQuarantineReconcile: reconcile,
}));

let fixture: Fixture;
// Index map into fixture.photoIds for readability.
const RATED = [0, 1, 2, 3]; // rated via direct state update (no rating event)
const OWN_RATER = 4; // rated via a real rating event by the reviewer
const NON_RATED = 5; // left in the default 'not_required' state

beforeAll(async () => {
  fixture = await seed({ photos: 6, tags: 1 });
  const supabase = service();

  // Mark photos 0..3 as rated so the routes' `.eq('rating_state','rated')`
  // guard matches them, without threading them through the rating workflow.
  const { error: rateErr } = await supabase
    .from("photos")
    .update({ rating_state: "rated", current_rating: 4 })
    .in("id", RATED.map((i) => fixture.photoIds[i]));
  if (rateErr) throw new Error(`seed rated photos: ${rateErr.message}`);

  // Photo 4 is rated by the reviewer via a real rating event — the trigger
  // flips it to rating_state='rated' and records the rater for the own-rater
  // authorization path.
  const { error: evErr } = await supabase.from("photo_rating_events").insert({
    photo_id: fixture.photoIds[OWN_RATER],
    reviewer_id: fixture.reviewer.id,
    rating: 5,
  });
  if (evErr) throw new Error(`seed rating event: ${evErr.message}`);
  // Photo 5 is intentionally left non-rated.
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(async () => {
  setMockAuth({ kind: "unauthenticated" });
  reconcile.mockReset();
  reconcile.mockResolvedValue({
    ok: true,
    action: "quarantine",
    drift: false,
    message: "",
    syncLogId: null,
  });
  // Reset visibility so each test starts from a known state.
  await service()
    .from("photos")
    .update({ is_quarantined: false })
    .eq("camp_week_id", fixture.campWeekId);
});

async function isQuarantined(photoId: string): Promise<boolean | null | undefined> {
  const { data } = await service()
    .from("photos")
    .select("is_quarantined")
    .eq("id", photoId)
    .single();
  return data?.is_quarantined;
}

// ─── single toggle ───────────────────────────────────────────────────────────

async function postQuarantine(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/photo-rating/quarantine/route");
  return POST(
    new Request("http://localhost/api/photo-rating/quarantine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/photo-rating/quarantine", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postQuarantine({ photo_id: fixture.photoIds[RATED[0]], quarantined: true });
    expect(res.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid `quarantined` flag with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postQuarantine({ photo_id: fixture.photoIds[RATED[0]] });
    expect(res.status).toBe(400);
  });

  it("rejects a non-rater, non-privileged caller with 403", async () => {
    // Reviewer acting on a photo they did NOT rate (no rating event).
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postQuarantine({ photo_id: fixture.photoIds[RATED[0]], quarantined: true });
    expect(res.status).toBe(403);
    expect(await isQuarantined(fixture.photoIds[RATED[0]])).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("senior can hide any photo, flipping is_quarantined and reconciling", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postQuarantine({ photo_id: fixture.photoIds[RATED[1]], quarantined: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.drift).toBe(false);

    expect(await isQuarantined(fixture.photoIds[RATED[1]])).toBe(true);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][1]).toBe(fixture.photoIds[RATED[1]]);
  });

  it("senior can restore (un-hide) a photo", async () => {
    const photoId = fixture.photoIds[RATED[1]];
    await service().from("photos").update({ is_quarantined: true }).eq("id", photoId);

    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postQuarantine({ photo_id: photoId, quarantined: false });
    expect(res.status).toBe(200);
    expect(await isQuarantined(photoId)).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("admin can hide any photo", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const res = await postQuarantine({ photo_id: fixture.photoIds[RATED[2]], quarantined: true });
    expect(res.status).toBe(200);
    expect(await isQuarantined(fixture.photoIds[RATED[2]])).toBe(true);
  });

  it("a photo's own rater can toggle it even without senior/admin role", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postQuarantine({ photo_id: fixture.photoIds[OWN_RATER], quarantined: true });
    expect(res.status).toBe(200);
    expect(await isQuarantined(fixture.photoIds[OWN_RATER])).toBe(true);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

// ─── bulk toggle ───────────────────────────────────────────────────────────

async function postBulk(body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/photo-rating/bulk-quarantine/route");
  return POST(
    new Request("http://localhost/api/photo-rating/bulk-quarantine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/photo-rating/bulk-quarantine", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await postBulk({ photo_ids: [fixture.photoIds[RATED[0]]], quarantined: true });
    expect(res.status).toBe(401);
  });

  it("rejects the reviewer role with 403 (senior/admin only)", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await postBulk({ photo_ids: [fixture.photoIds[RATED[0]]], quarantined: true });
    expect(res.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("rejects an empty/invalid photo_ids array with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postBulk({ photo_ids: [], quarantined: true });
    expect(res.status).toBe(400);
  });

  it("rejects a non-boolean `quarantined` with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postBulk({ photo_ids: [fixture.photoIds[RATED[0]]], quarantined: "yes" });
    expect(res.status).toBe(400);
  });

  it("rejects more than 60 photos with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const ids = Array.from({ length: 61 }, () => randomUUID());
    const res = await postBulk({ photo_ids: ids, quarantined: true });
    expect(res.status).toBe(400);
  });

  it("senior bulk-hides every rated photo and reconciles each", async () => {
    const ids = [fixture.photoIds[RATED[0]], fixture.photoIds[RATED[1]]];
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postBulk({ photo_ids: ids, quarantined: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(2);

    expect(await isQuarantined(ids[0])).toBe(true);
    expect(await isQuarantined(ids[1])).toBe(true);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("only counts/reconciles rated photos, skipping non-rated ones", async () => {
    const ids = [fixture.photoIds[RATED[0]], fixture.photoIds[NON_RATED]];
    setMockAuth({ kind: "user", userId: fixture.senior.id, role: "senior" });
    const res = await postBulk({ photo_ids: ids, quarantined: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(1);

    expect(await isQuarantined(fixture.photoIds[RATED[0]])).toBe(true);
    expect(await isQuarantined(fixture.photoIds[NON_RATED])).toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][1]).toBe(fixture.photoIds[RATED[0]]);
  });
});
