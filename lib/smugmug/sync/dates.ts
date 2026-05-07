import "server-only";

/**
 * Parses an iD Tech camp-week folder name into a (start, end) date pair.
 *
 * iD Tech's naming has been mostly consistent since 2014, but a few
 * historical formats slip through:
 *
 *   FULL          "July 28 - August 1, 2025"     (canonical — month differs across boundary)
 *   FULL          "May 25 – May 29, 2026"        (en-dash variant; same shape otherwise)
 *   FULL          "August 4 - 8, 2025"           (right-side month omitted)
 *   FULL          "December 30 - January 3, 2026"(cross-year; the year applies to the end date)
 *   HYPHENATED    "June-02-June-06-2014"         (rare; an old folder-naming typo)
 *   YEARLESS      "June 24 - 28"                 (year inferred from parent year folder)
 *
 * The walker passes a `yearHint` (the parent year folder, when applicable)
 * so YEARLESS names can still resolve. Hint is ignored if the name already
 * carries a year.
 *
 * Returns null if no pattern matches. Callers decide whether to skip,
 * report, or surface the failure.
 */

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const FULL_PATTERN =
  /^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(?:([A-Za-z]+)\s+)?(\d{1,2}),\s*(\d{4})\s*$/;

const HYPHENATED_PATTERN =
  /^([A-Za-z]+)-(\d{1,2})-(?:([A-Za-z]+)-)?(\d{1,2})-(\d{4})\s*$/;

const YEARLESS_PATTERN =
  /^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(?:([A-Za-z]+)\s+)?(\d{1,2})\s*$/;

export interface ParsedWeekRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  year: number;
}

export function parseCampWeekName(
  name: string,
  yearHint?: number
): ParsedWeekRange | null {
  const trimmed = name.trim();

  const fullOrHyphen = FULL_PATTERN.exec(trimmed) ?? HYPHENATED_PATTERN.exec(trimmed);
  if (fullOrHyphen) {
    const [, sm, sd, em, ed, yr] = fullOrHyphen;
    return assemble(sm, sd, em, ed, Number(yr));
  }

  if (yearHint !== undefined) {
    const yearless = YEARLESS_PATTERN.exec(trimmed);
    if (yearless) {
      const [, sm, sd, em, ed] = yearless;
      return assemble(sm, sd, em, ed, yearHint);
    }
  }

  return null;
}

function assemble(
  startMonthRaw: string,
  startDayRaw: string,
  endMonthRawOpt: string | undefined,
  endDayRaw: string,
  year: number
): ParsedWeekRange | null {
  const startMonth = MONTHS[startMonthRaw.toLowerCase()];
  const endMonth =
    endMonthRawOpt !== undefined ? MONTHS[endMonthRawOpt.toLowerCase()] : startMonth;

  if (startMonth === undefined || endMonth === undefined) return null;

  const startDay = Number(startDayRaw);
  const endDay = Number(endDayRaw);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || !Number.isFinite(year)) {
    return null;
  }

  // Cross-year edge case: "December 30 - January 3, 2026" anchors year on
  // the end date; the start is in the prior year.
  const startYear = endMonth < startMonth ? year - 1 : year;
  const endYear = year;

  const start = formatDate(startYear, startMonth, startDay);
  const end = formatDate(endYear, endMonth, endDay);
  if (!start || !end) return null;

  return { startDate: start, endDate: end, year };
}

function formatDate(year: number, monthIndex: number, day: number): string | null {
  if (monthIndex < 0 || monthIndex > 11) return null;
  if (day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, monthIndex, day));
  // Reject if the Date object normalized away an invalid combination
  // (e.g. Feb 30 → March 2).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
