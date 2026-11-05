import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPublicPath } from "@/lib/supabase/middleware";

// Vercel Cron calls carry no session cookie. If a cron path isn't in the
// middleware's PUBLIC_PATHS, the request is redirected to /login and the
// handler silently never runs — which happened to the photo-rating sweep and
// the weekly upload check until this test existed.

const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
  crons?: { path: string }[];
};

describe("middleware public paths", () => {
  it("covers every Vercel cron path", () => {
    const crons = (vercel.crons ?? []).map((c) => c.path.split("?")[0]);
    expect(crons.length).toBeGreaterThan(0);
    expect(crons.filter((p) => !isPublicPath(p))).toEqual([]);
  });

  it("still protects app pages and other API routes", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/api/photo-rating/events")).toBe(false);
    expect(isPublicPath("/api/triage/sweep-claims-extra")).toBe(false);
  });
});
