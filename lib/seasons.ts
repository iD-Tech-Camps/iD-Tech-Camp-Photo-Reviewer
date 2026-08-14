// A "season" is the calendar year a camp week starts in — the same model
// migration 52 uses for rating scope (camp_week_rating_ordinal). There is no
// seasons table; the year is derived from camp_weeks.starts_on, which needs no
// schema and matches how camp actually runs.
//
// Kept separate from the hub/gallery data layers so both surfaces label and
// default seasons identically, and so the logic is unit-testable without a DB.

/** Inclusive `starts_on` bounds for a season year, as YYYY-MM-DD. */
export function seasonDateRange(year: number): { from: string; to: string } {
  const y = String(year).padStart(4, "0");
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Season year for a `starts_on` date string. Null when unparseable. */
export function seasonOf(startsOn: string | null | undefined): number | null {
  if (!startsOn) return null;
  // starts_on is a DATE column — always YYYY-MM-DD. Parsing the prefix avoids
  // `new Date("2025-06-01")` resolving as UTC midnight and shifting a day back
  // for viewers west of Greenwich, which would file a Jan 1 week under the
  // previous season.
  const year = Number(startsOn.slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

/** Distinct season years present in a set of dates, newest first. */
export function seasonsFromDates(startsOnValues: (string | null | undefined)[]): number[] {
  const years = new Set<number>();
  for (const value of startsOnValues) {
    const year = seasonOf(value);
    if (year !== null) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * Which season a surface should open on. The current year when it has weeks,
 * otherwise the most recent season that does — so an admin visiting in the
 * off-season lands on real work instead of an empty screen. Null when there is
 * nothing at all.
 */
export function pickDefaultSeason(seasons: number[], currentYear: number): number | null {
  if (seasons.length === 0) return null;
  if (seasons.includes(currentYear)) return currentYear;
  const past = seasons.filter((s) => s < currentYear);
  // Prefer the most recent past season; fall back to the earliest future one
  // (weeks can be created ahead of time for next season).
  if (past.length > 0) return Math.max(...past);
  return Math.min(...seasons);
}

export function seasonLabel(year: number): string {
  return `${year} season`;
}
