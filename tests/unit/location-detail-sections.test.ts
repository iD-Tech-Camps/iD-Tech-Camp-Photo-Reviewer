import { describe, expect, it } from "vitest";
import {
  groupFeedbackByWeek,
  partitionLocationWeeks,
} from "@/lib/location-detail-sections";
import type { FeedbackEvent, LocationCampWeek } from "@/lib/location-approval";

function week(
  id: string,
  opts: Partial<LocationCampWeek> = {},
): LocationCampWeek {
  return {
    id,
    name: id,
    startsOn: "2026-06-01",
    endsOn: "2026-06-05",
    triageRole: "first_week",
    triageState: "photos_in",
    totalPhotos: 10,
    pendingCount: 0,
    flaggedCount: 0,
    signoffAt: null,
    signoffByName: null,
    positiveGreatQuality: false,
    positiveGreatVariety: false,
    positiveShininessGreat: false,
    assessmentTagIds: [],
    ...opts,
  };
}

function feedback(id: string, campWeekId: string | null): FeedbackEvent {
  return {
    id,
    body: id,
    createdAt: "2026-06-02T00:00:00Z",
    authorName: "Lead",
    authorEmail: null,
    campWeekId,
    campWeekName: null,
    tagIds: [],
  };
}

describe("partitionLocationWeeks", () => {
  it("routes weeks into needsReview / recentlyReviewed / pastSeasons", () => {
    const parts = partitionLocationWeeks([
      week("active"),
      week("reviewed", { signoffAt: "2026-06-10T00:00:00Z" }),
      week("past", { triageRole: "none", totalPhotos: 7 }),
    ]);

    expect(parts.needsReview.map((w) => w.id)).toEqual(["active"]);
    expect(parts.recentlyReviewed.map((w) => w.id)).toEqual(["reviewed"]);
    expect(parts.pastSeasons.map((w) => w.id)).toEqual(["past"]);
  });

  it("drops out-of-season weeks that never had submitted photos", () => {
    const parts = partitionLocationWeeks([
      week("dormant", { triageRole: "none", totalPhotos: 0, signoffAt: null }),
    ]);

    expect(parts.needsReview).toHaveLength(0);
    expect(parts.recentlyReviewed).toHaveLength(0);
    expect(parts.pastSeasons).toHaveLength(0);
  });

  it("sorts needsReview by flagged, then pending, then start date", () => {
    const parts = partitionLocationWeeks([
      week("calm", { startsOn: "2026-06-01", flaggedCount: 0, pendingCount: 0 }),
      week("early-pending", { startsOn: "2026-06-08", flaggedCount: 0, pendingCount: 3 }),
      week("flagged", { startsOn: "2026-06-15", flaggedCount: 2, pendingCount: 0 }),
    ]);

    expect(parts.needsReview.map((w) => w.id)).toEqual(["flagged", "early-pending", "calm"]);
  });

  it("sorts recentlyReviewed by most-recent signoff first", () => {
    const parts = partitionLocationWeeks([
      week("older", { signoffAt: "2026-06-05T00:00:00Z" }),
      week("newer", { signoffAt: "2026-06-20T00:00:00Z" }),
    ]);

    expect(parts.recentlyReviewed.map((w) => w.id)).toEqual(["newer", "older"]);
  });

  it("sorts pastSeasons newest start date first", () => {
    const parts = partitionLocationWeeks([
      week("y2024", { triageRole: "none", totalPhotos: 5, startsOn: "2024-06-01" }),
      week("y2025", { triageRole: "none", totalPhotos: 5, startsOn: "2025-06-01" }),
    ]);

    expect(parts.pastSeasons.map((w) => w.id)).toEqual(["y2025", "y2024"]);
  });
});

describe("groupFeedbackByWeek", () => {
  it("groups events under their week and collects unassigned legacy notes", () => {
    const { byWeek, unassigned } = groupFeedbackByWeek([
      feedback("a", "w1"),
      feedback("b", "w1"),
      feedback("c", "w2"),
      feedback("legacy", null),
    ]);

    expect(byWeek.get("w1")?.map((e) => e.id)).toEqual(["a", "b"]);
    expect(byWeek.get("w2")?.map((e) => e.id)).toEqual(["c"]);
    expect(unassigned.map((e) => e.id)).toEqual(["legacy"]);
  });
});
