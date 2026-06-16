import { describe, expect, it } from "vitest";
import { partitionReviewHubWeeks } from "@/lib/review-hub-sections";

describe("partitionReviewHubWeeks", () => {
  const weeks = [
    // photos waiting on a reviewer → active
    { id: "a", startsOn: "2026-05-01", photoCount: 10, pendingCount: 4 },
    // no photos in yet → upcoming
    { id: "b", startsOn: "2026-06-15", photoCount: 0, pendingCount: 0 },
    // future week with early photos still pending → active
    { id: "c", startsOn: "2026-07-01", photoCount: 5, pendingCount: 5 },
    // future week, no photos → upcoming
    { id: "d", startsOn: "2026-08-01", photoCount: 0, pendingCount: 0 },
    // started week, no photos yet → upcoming
    { id: "e", startsOn: "2026-05-20", photoCount: 0, pendingCount: 0 },
    // photos in but none pending (fully reviewed / awaiting lead) → dropped
    { id: "f", startsOn: "2026-05-10", photoCount: 8, pendingCount: 0 },
  ];

  it("puts only weeks with pending photos into active", () => {
    const { active } = partitionReviewHubWeeks(weeks);
    expect(active.map((w) => w.id)).toEqual(["a", "c"]);
  });

  it("puts weeks with no photos yet into upcoming", () => {
    const { upcoming } = partitionReviewHubWeeks(weeks);
    expect(upcoming.map((w) => w.id)).toEqual(["b", "d", "e"]);
  });

  it("drops fully-reviewed weeks (photos in, none pending) from both sections", () => {
    const { active, upcoming } = partitionReviewHubWeeks(weeks);
    expect(active.map((w) => w.id)).not.toContain("f");
    expect(upcoming.map((w) => w.id)).not.toContain("f");
  });
});
