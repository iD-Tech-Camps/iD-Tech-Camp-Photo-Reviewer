import type { SeniorRollupWeek } from "@/lib/triage-senior";

export type SeniorHubSection = "needReview" | "inProgress" | "upcoming" | "finished";

export type SeniorHubPartition = Record<SeniorHubSection, SeniorRollupWeek[]>;

export function partitionSeniorHubWeeks(weeks: SeniorRollupWeek[]): SeniorHubPartition {
  const result: SeniorHubPartition = {
    needReview: [],
    inProgress: [],
    upcoming: [],
    finished: [],
  };

  for (const w of weeks) {
    if (w.triageState === "complete") {
      result.finished.push(w);
    } else if (w.triageState === "awaiting_photos") {
      result.upcoming.push(w);
    } else if (
      w.triageState === "triage_done"
      || w.triageState === "senior_review"
      || w.flaggedCount > 0
    ) {
      result.needReview.push(w);
    } else if (w.triageState === "photos_in" || w.triageState === "triage_in_progress") {
      result.inProgress.push(w);
    }
  }

  return result;
}
