/** Shared Active / Upcoming split for Camp Quality and Camp Photo review hubs. */

export type ReviewHubWeekSlice = {
  startsOn: string;
  photoCount: number;
  pendingCount: number;
};

export function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function partitionReviewHubWeeks<T extends ReviewHubWeekSlice>(
  weeks: T[],
): { active: T[]; upcoming: T[] } {
  const active: T[] = [];
  const upcoming: T[] = [];

  for (const w of weeks) {
    if (w.pendingCount > 0) {
      // Photos are waiting on a reviewer — this is the only thing the hub
      // calls "active." A week reappears here if a later sync adds photos.
      active.push(w);
    } else if (w.photoCount === 0) {
      // No photos in yet: a started-but-empty week (late uploads) or a
      // future week. Surface it as Upcoming so reviewers see what's coming.
      upcoming.push(w);
    }
    // Otherwise the week has photos but none pending — fully handled (every
    // photo reviewed, or only awaiting lead sign-off). There's nothing for a
    // reviewer to do, so it drops off the hub entirely. Leads pick these up
    // from the dedicated Lead review hub.
  }

  return { active, upcoming };
}
