import type { FeedbackEvent, LocationCampWeek } from "@/lib/location-approval";

// Buckets for the Lead's location-detail screen. Weeks that never needed a
// Lead's review (out of season AND nothing submitted) are dropped entirely so
// the screen stops dumping years of dormant weeks. The rest sort into where
// they sit in the review workflow. See lib/senior-hub-sections.ts for the
// sibling pattern on the week-rollup hub.
export type LocationWeekSection = "needsReview" | "recentlyReviewed" | "pastSeasons";

export type LocationWeekPartition = Record<LocationWeekSection, LocationCampWeek[]>;

export function partitionLocationWeeks(weeks: LocationCampWeek[]): LocationWeekPartition {
  const result: LocationWeekPartition = {
    needsReview: [],
    recentlyReviewed: [],
    pastSeasons: [],
  };

  for (const w of weeks) {
    const inSeason = w.triageRole !== "none";
    if (!inSeason) {
      // Out of season: keep only weeks that actually had review activity, as a
      // record. A dormant out-of-season week with no photos never needed review.
      if (w.totalPhotos > 0) result.pastSeasons.push(w);
      continue;
    }
    if (w.signoffAt) result.recentlyReviewed.push(w);
    else result.needsReview.push(w);
  }

  // Urgent current-season work first; most-recently signed off next; newest
  // historical records first.
  result.needsReview.sort(
    (a, b) =>
      b.flaggedCount - a.flaggedCount ||
      b.pendingCount - a.pendingCount ||
      a.startsOn.localeCompare(b.startsOn),
  );
  result.recentlyReviewed.sort((a, b) => (b.signoffAt ?? "").localeCompare(a.signoffAt ?? ""));
  result.pastSeasons.sort((a, b) => b.startsOn.localeCompare(a.startsOn));

  return result;
}

export type GroupedFeedback = {
  byWeek: Map<string, FeedbackEvent[]>;
  unassigned: FeedbackEvent[];
};

// Feedback is per-week. Group events under their week so each week card shows
// its own thread; legacy events with no week (campWeekId === null) fall into
// `unassigned` so no historical note is lost.
export function groupFeedbackByWeek(events: FeedbackEvent[]): GroupedFeedback {
  const byWeek = new Map<string, FeedbackEvent[]>();
  const unassigned: FeedbackEvent[] = [];

  for (const e of events) {
    if (!e.campWeekId) {
      unassigned.push(e);
      continue;
    }
    const list = byWeek.get(e.campWeekId);
    if (list) list.push(e);
    else byWeek.set(e.campWeekId, [e]);
  }

  return { byWeek, unassigned };
}
