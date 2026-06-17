import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 0 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(async () => {
  setMockAuth({ kind: "unauthenticated" });
  // Reset the fixture division to a known state (synced=false) between tests.
  await service().from("divisions").update({ synced: false }).eq("id", fixture.divisionId);
});

async function patch(body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/smugmug/sync-folders/route");
  return PATCH(
    new NextRequest("http://localhost/api/smugmug/sync-folders", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("PATCH /api/smugmug/sync-folders", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await patch({ divisionId: fixture.divisionId, synced: true });
    expect(res.status).toBe(401);
  });

  it("rejects reviewer role with 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const res = await patch({ divisionId: fixture.divisionId, synced: true });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });

    expect((await patch({ synced: true })).status).toBe(400); // missing divisionId
    expect((await patch({ divisionId: fixture.divisionId })).status).toBe(400); // missing synced
    expect((await patch({ divisionId: 123, synced: true })).status).toBe(400); // wrong type
  });

  it("returns 404 for an unknown divisionId", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const res = await patch({
      divisionId: "00000000-0000-0000-0000-000000000000",
      synced: true,
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("division_not_found");
  });

  it("admin flips synced on and off and the row changes", async () => {
    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });

    const on = await patch({ divisionId: fixture.divisionId, synced: true });
    expect(on.status).toBe(200);
    const onJson = await on.json();
    expect(onJson.division?.id).toBe(fixture.divisionId);
    expect(onJson.division?.synced).toBe(true);

    const afterOn = await service()
      .from("divisions")
      .select("synced")
      .eq("id", fixture.divisionId)
      .single();
    expect(afterOn.data?.synced).toBe(true);

    const off = await patch({ divisionId: fixture.divisionId, synced: false });
    expect(off.status).toBe(200);
    expect((await off.json()).division?.synced).toBe(false);

    const afterOff = await service()
      .from("divisions")
      .select("synced")
      .eq("id", fixture.divisionId)
      .single();
    expect(afterOff.data?.synced).toBe(false);
  });
});
