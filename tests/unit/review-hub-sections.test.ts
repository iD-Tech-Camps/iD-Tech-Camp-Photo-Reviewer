import { describe, expect, it } from "vitest";
import { partitionReviewHubWeeks } from "@/lib/review-hub-sections";

describe("partitionReviewHubWeeks", () => {
  const weeks = [
    { id: "a", startsOn: "2026-05-01", photoCount: 10 },
    { id: "b", startsOn: "2026-06-15", photoCount: 0 },
    { id: "c", startsOn: "2026-07-01", photoCount: 5 },
    { id: "d", startsOn: "2026-08-01", photoCount: 0 },
    { id: "e", startsOn: "2026-05-20", photoCount: 0 },
  ];

  it("splits weeks with photos into active and empty weeks into upcoming", () => {
    const { active, upcoming } = partitionReviewHubWeeks(weeks);
    expect(active.map((w) => w.id)).toEqual(["a", "c"]);
    expect(upcoming.map((w) => w.id)).toEqual(["b", "d", "e"]);
  });

  it("puts future weeks with early photos in active", () => {
    const { active, upcoming } = partitionReviewHubWeeks(weeks);
    expect(active.map((w) => w.id)).toContain("c");
    expect(upcoming.map((w) => w.id)).not.toContain("c");
  });

  it("puts started weeks with zero photos in upcoming", () => {
    const { active, upcoming } = partitionReviewHubWeeks(weeks);
    expect(upcoming.map((w) => w.id)).toContain("e");
    expect(active.map((w) => w.id)).not.toContain("e");
  });
});
