import { describe, expect, it } from "vitest";
import {
  pickDefaultSeason,
  seasonDateRange,
  seasonLabel,
  seasonOf,
  seasonsFromDates,
} from "@/lib/seasons";

describe("seasonOf", () => {
  it("reads the year off a starts_on date", () => {
    expect(seasonOf("2025-06-01")).toBe(2025);
    expect(seasonOf("2026-12-31")).toBe(2026);
  });

  it("does not shift a Jan 1 week into the previous season", () => {
    // new Date("2026-01-01") is UTC midnight, which is 2025-12-31 for any
    // viewer west of Greenwich. Parsing the prefix avoids that entirely.
    expect(seasonOf("2026-01-01")).toBe(2026);
  });

  it("returns null for missing or malformed values", () => {
    expect(seasonOf(null)).toBeNull();
    expect(seasonOf(undefined)).toBeNull();
    expect(seasonOf("")).toBeNull();
    expect(seasonOf("not-a-date")).toBeNull();
  });
});

describe("seasonDateRange", () => {
  it("spans the whole calendar year", () => {
    expect(seasonDateRange(2025)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
});

describe("seasonsFromDates", () => {
  it("dedupes and orders newest first", () => {
    expect(
      seasonsFromDates(["2025-06-01", "2026-07-04", "2025-08-11", "2024-06-02"]),
    ).toEqual([2026, 2025, 2024]);
  });

  it("skips unusable values rather than emitting NaN", () => {
    expect(seasonsFromDates([null, "2026-06-01", undefined, ""])).toEqual([2026]);
  });

  it("returns an empty list for no input", () => {
    expect(seasonsFromDates([])).toEqual([]);
  });
});

describe("pickDefaultSeason", () => {
  it("prefers the current year when it has weeks", () => {
    expect(pickDefaultSeason([2026, 2025, 2024], 2026)).toBe(2026);
  });

  it("falls back to the most recent past season in the off-season", () => {
    // Visiting in 2027 before any 2027 week exists should land on real work,
    // not an empty screen.
    expect(pickDefaultSeason([2026, 2025], 2027)).toBe(2026);
  });

  it("uses the earliest future season when only future weeks exist", () => {
    expect(pickDefaultSeason([2028, 2027], 2026)).toBe(2027);
  });

  it("returns null when there are no seasons at all", () => {
    expect(pickDefaultSeason([], 2026)).toBeNull();
  });
});

describe("seasonLabel", () => {
  it("labels a year as a season", () => {
    expect(seasonLabel(2025)).toBe("2025 season");
  });
});
