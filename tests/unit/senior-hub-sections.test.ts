import { describe, expect, it } from "vitest";
import { partitionSeniorHubWeeks } from "@/lib/senior-hub-sections";
import type { SeniorRollupWeek } from "@/lib/triage-senior";

function week(
  id: string,
  triageState: string,
  flaggedCount = 0,
): SeniorRollupWeek {
  return {
    id,
    name: id,
    locationName: "Loc",
    triageRole: "first_week",
    triageState,
    startsOn: "2026-06-01",
    endsOn: "2026-06-05",
    totalPhotos: 10,
    pendingCount: 0,
    inProgressCount: 0,
    cleanCount: 0,
    flaggedCount,
    deletedCount: 0,
    quarantinedCount: 0,
    signoffAt: null,
    signoffByName: null,
  };
}

describe("partitionSeniorHubWeeks", () => {
  it("routes weeks into the four lead hub sections", () => {
    const parts = partitionSeniorHubWeeks([
      week("done", "triage_done"),
      week("senior", "senior_review"),
      week("flagged", "triage_in_progress", 2),
      week("working", "triage_in_progress"),
      week("future", "awaiting_photos"),
      week("approved", "complete"),
    ]);

    expect(parts.needReview.map((w) => w.id)).toEqual(["done", "senior", "flagged"]);
    expect(parts.inProgress.map((w) => w.id)).toEqual(["working"]);
    expect(parts.upcoming.map((w) => w.id)).toEqual(["future"]);
    expect(parts.finished.map((w) => w.id)).toEqual(["approved"]);
  });
});
