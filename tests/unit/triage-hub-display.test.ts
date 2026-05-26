import { describe, expect, it } from "vitest";
import {
  campQualityHubStatusLabel,
  isCampQualityAwaitingLeadReview,
} from "@/lib/triage-hub-display";

describe("campQualityHubStatusLabel", () => {
  it("shows waiting for lead review when staff triage is done", () => {
    expect(campQualityHubStatusLabel("triage_done")).toBe("Waiting for lead review");
    expect(campQualityHubStatusLabel("senior_review")).toBe("Waiting for lead review");
  });

  it("keeps in-progress labels for active review", () => {
    expect(campQualityHubStatusLabel("triage_in_progress")).toBe("In review");
    expect(campQualityHubStatusLabel("photos_in")).toBe("Not started");
  });
});

describe("isCampQualityAwaitingLeadReview", () => {
  it("matches post-staff states before lead sign-off", () => {
    expect(isCampQualityAwaitingLeadReview("triage_done")).toBe(true);
    expect(isCampQualityAwaitingLeadReview("senior_review")).toBe(true);
    expect(isCampQualityAwaitingLeadReview("triage_in_progress")).toBe(false);
  });
});
