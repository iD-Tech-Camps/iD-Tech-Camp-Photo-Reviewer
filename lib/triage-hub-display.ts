/** User-facing labels for camp quality hub week rows. */

const CAMP_QUALITY_WEEK_STATE_LABEL: Record<string, string> = {
  not_required: "Not in season",
  awaiting_photos: "Awaiting photos",
  photos_in: "Not started",
  triage_in_progress: "In review",
  triage_done: "Ready for sign-off",
  senior_review: "In sign-off",
  complete: "Done",
};

const AWAITING_LEAD_REVIEW = new Set(["triage_done", "senior_review"]);

export function isCampQualityAwaitingLeadReview(triageState: string): boolean {
  return AWAITING_LEAD_REVIEW.has(triageState);
}

export function campQualityHubStatusLabel(triageState: string): string {
  if (isCampQualityAwaitingLeadReview(triageState)) return "Waiting for lead review";
  return CAMP_QUALITY_WEEK_STATE_LABEL[triageState] ?? triageState;
}
