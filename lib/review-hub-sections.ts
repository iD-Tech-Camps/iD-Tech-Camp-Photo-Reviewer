/** Shared Active / Upcoming split for Camp Quality and Camp Photo review hubs. */

export type ReviewHubWeekSlice = {
  startsOn: string;
  photoCount: number;
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
  today: string = todayYmdLocal(),
): { active: T[]; upcoming: T[] } {
  const active: T[] = [];
  const upcoming: T[] = [];

  for (const w of weeks) {
    const started = w.startsOn <= today;
    const hasPhotos = w.photoCount > 0;

    if (started && hasPhotos) {
      active.push(w);
    } else if (!started && !hasPhotos) {
      upcoming.push(w);
    }
    // Future weeks that already have synced photos surface in Active.
    else if (!started && hasPhotos) {
      active.push(w);
    }
  }

  return { active, upcoming };
}
