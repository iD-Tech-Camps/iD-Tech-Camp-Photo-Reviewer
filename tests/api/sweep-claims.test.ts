import "../auth-mock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed, service, teardown, type Fixture } from "../fixtures";

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seed({ photos: 2 });
});

afterAll(async () => {
  await teardown(fixture);
});

async function getSweep(headers: Record<string, string> = {}): Promise<Response> {
  const { GET } = await import("@/app/api/triage/sweep-claims/route");
  return GET(
    new Request("http://localhost/api/triage/sweep-claims", { method: "GET", headers }),
  );
}

describe("GET /api/triage/sweep-claims", () => {
  it("rejects callers without CRON_SECRET with 401", async () => {
    const res = await getSweep();
    expect(res.status).toBe(401);
  });

  it("expires claims whose last_activity_at is older than claim_expiry_minutes", async () => {
    const supabase = service();

    // Set a 1-minute expiry to make the test fast and deterministic.
    const { data: cfg } = await supabase
      .from("triage_config")
      .select("claim_expiry_minutes")
      .eq("id", 1)
      .single();
    const prevExpiry = cfg?.claim_expiry_minutes ?? 60;
    await supabase.from("triage_config").update({ claim_expiry_minutes: 1 }).eq("id", 1);

    try {
      // Insert an active claim with last_activity_at well past the expiry.
      const stale = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data: claim, error: insErr } = await supabase
        .from("triage_claims")
        .insert({
          camp_week_id: fixture.campWeekId,
          reviewer_id: fixture.reviewer.id,
          slice_size: 1,
          claimed_at: stale,
          last_activity_at: stale,
        })
        .select("id")
        .single();
      if (insErr || !claim) throw new Error(`seed stale claim: ${insErr?.message}`);

      const res = await getSweep({ authorization: `Bearer ${process.env.CRON_SECRET}` });
      expect(res.status).toBe(200);

      const { data: after } = await supabase
        .from("triage_claims")
        .select("released_at, release_reason")
        .eq("id", claim.id)
        .single();
      expect(after?.released_at).toBeTruthy();
      expect(after?.release_reason).toBe("auto_expired");

      await supabase.from("triage_claims").delete().eq("id", claim.id);
    } finally {
      await supabase.from("triage_config").update({ claim_expiry_minutes: prevExpiry }).eq("id", 1);
    }
  });
});
