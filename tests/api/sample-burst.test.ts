import "../auth-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMockAuth } from "../auth-mock";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 5 });
});

afterAll(async () => {
  await teardown(fixture);
});

beforeEach(() => {
  setMockAuth({ kind: "unauthenticated" });
});

async function loadHandlers() {
  return await import("@/app/api/triage/sample-burst/route");
}

function buildReq(method: "GET" | "POST", headers: Record<string, string> = {}, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("http://localhost/api/triage/sample-burst", init);
}

async function setSampleWindow(dow: number, hour: number): Promise<void> {
  const supabase = service();
  await supabase.from("triage_config").update({ sample_burst_dow: dow, sample_burst_hour: hour }).eq("id", 1);
}

describe("GET/POST /api/triage/sample-burst", () => {
  it("GET without CRON_SECRET returns 401", async () => {
    const { GET } = await loadHandlers();
    const res = await GET(buildReq("GET"));
    expect(res.status).toBe(401);
  });

  it("GET with CRON_SECRET no-ops outside configured day/hour", async () => {
    // Push the gate to a day/hour that almost certainly differs from "now".
    const now = new Date();
    const wrongDow = (now.getUTCDay() + 3) % 7;
    const wrongHour = (now.getUTCHours() + 13) % 24;
    await setSampleWindow(wrongDow, wrongHour);

    const { GET } = await loadHandlers();
    const res = await GET(buildReq("GET", { authorization: `Bearer ${process.env.CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
  });

  it("POST as admin bypasses the day/hour gate", async () => {
    // Keep the gate misaligned with "now" to prove the admin path bypasses it.
    const now = new Date();
    await setSampleWindow((now.getUTCDay() + 3) % 7, (now.getUTCHours() + 13) % 24);

    setMockAuth({ kind: "user", userId: fixture.admin.id, role: "admin" });
    const { POST } = await loadHandlers();
    const res = await POST(buildReq("POST"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.skipped).toBeUndefined();
    expect(typeof json.photosMarked).toBe("number");
  });

  it("POST as reviewer returns 403", async () => {
    setMockAuth({ kind: "user", userId: fixture.reviewer.id, role: "reviewer" });
    const { POST } = await loadHandlers();
    const res = await POST(buildReq("POST"));
    expect(res.status).toBe(403);
  });
});
