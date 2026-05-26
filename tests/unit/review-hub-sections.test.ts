import { describe, expect, it } from "vitest";
import { partitionReviewHubWeeks } from "@/lib/review-hub-sections";

describe("partitionReviewHubWeeks", () => {
  const weeks = [
    { id: "a", startsOn: "2026-05-01", photoCount: 10 },
    { id: "b", startsOn: "2026-06-15", photoCount: 0 },
    { id: "c", startsOn: "2026-07-01", photoCount: 5 },
    { id: "d", startsOn: "2026-08-01", photoCount: 0 },
  ];

  it("splits started weeks with photos into active and future empty weeks into upcoming", () => {
    const { active, upcoming } = partitionReviewHubWeeks(weeks, "2026-06-01");
    expect(active.map((w) => w.id)).toEqual(["a", "c"]);
    expect(upcoming.map((w) => w.id)).toEqual(["b", "d"]);
  });

  it("puts future weeks with early photos in active", () => {
    const { active, upcoming } = partitionReviewHubWeeks(weeks, "2026-06-01");
    expect(active.map((w) => w.id)).toContain("c");
    expect(upcoming.map((w) => w.id)).not.toContain("c");
  });
});
