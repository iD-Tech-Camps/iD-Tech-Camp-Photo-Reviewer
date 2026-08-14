import { describe, expect, it } from "vitest";
import {
  formatCount,
  mapAdminOverviewStats,
  overviewTiles,
  qualityMeter,
  ratingMeter,
  sharePct,
  type AdminOverviewStats,
  type PhotoStats,
} from "@/lib/admin-stats";

const photos = (patch: Partial<PhotoStats> = {}): PhotoStats => ({
  total: 0,
  triageNotRequired: 0,
  triagePending: 0,
  triageInProgress: 0,
  triageClean: 0,
  triageFlagged: 0,
  triageDeleted: 0,
  ratingNotRequired: 0,
  ratingPending: 0,
  ratingInProgress: 0,
  ratingRated: 0,
  quarantined: 0,
  ...patch,
});

const stats = (patch: Partial<AdminOverviewStats> = {}): AdminOverviewStats => ({
  photos: photos(),
  weeks: {
    total: 0, awaitingPhotos: 0, notStarted: 0, inReview: 0,
    awaitingLead: 0, signedOff: 0, notRequired: 0,
  },
  locations: { total: 0, ignored: 0, approved: 0 },
  ...patch,
});

describe("sharePct", () => {
  it("returns 0 for an empty denominator", () => {
    expect(sharePct(0, 0)).toBe(0);
    expect(sharePct(5, 0)).toBe(0);
  });

  it("only reads 100% when the pipeline is actually finished", () => {
    expect(sharePct(100, 100)).toBe(100);
    expect(sharePct(9999, 10000)).toBe(99);
  });

  it("only reads 0% when nothing is done", () => {
    expect(sharePct(0, 10000)).toBe(0);
    expect(sharePct(1, 10000)).toBe(1);
  });

  it("rounds in between", () => {
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(2, 3)).toBe(67);
  });
});

describe("formatCount", () => {
  it("comma-groups counts below a million", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(942)).toBe("942");
    expect(formatCount(48231)).toBe("48,231");
    expect(formatCount(999999)).toBe("999,999");
  });

  it("compacts millions so a tile can't wrap", () => {
    expect(formatCount(1_240_000)).toBe("1.2M");
    expect(formatCount(12_400_000)).toBe("12M");
  });

  it("degrades rather than printing NaN", () => {
    expect(formatCount(Number.NaN)).toBe("—");
  });
});

describe("qualityMeter", () => {
  it("excludes out-of-scope photos from the denominator", () => {
    const m = qualityMeter(photos({
      triageNotRequired: 500,
      triagePending: 20,
      triageClean: 80,
    }));
    expect(m.inScope).toBe(100);
    expect(m.done).toBe(80);
    expect(m.donePct).toBe(80);
    expect(m.outOfScope).toBe(500);
  });

  it("counts flagged and lead-deleted photos as reviewed", () => {
    const m = qualityMeter(photos({
      triageClean: 10, triageFlagged: 5, triageDeleted: 5, triagePending: 80,
    }));
    expect(m.done).toBe(20);
    expect(m.inScope).toBe(100);
  });

  it("keeps in-progress work out of the done total", () => {
    const m = qualityMeter(photos({ triageClean: 10, triageInProgress: 10 }));
    expect(m.done).toBe(10);
    expect(m.inScope).toBe(20);
    expect(m.donePct).toBe(50);
  });

  it("reports an empty pipeline without dividing by zero", () => {
    const m = qualityMeter(photos());
    expect(m.inScope).toBe(0);
    expect(m.donePct).toBe(0);
  });
});

describe("ratingMeter", () => {
  it("scopes to the rating pipeline only", () => {
    const m = ratingMeter(photos({
      triageClean: 999,
      ratingNotRequired: 40,
      ratingRated: 30,
      ratingInProgress: 10,
      ratingPending: 10,
    }));
    expect(m.inScope).toBe(50);
    expect(m.done).toBe(30);
    expect(m.donePct).toBe(60);
    expect(m.outOfScope).toBe(40);
  });
});

describe("overviewTiles", () => {
  it("summarises the pipeline across six tiles", () => {
    const tiles = overviewTiles(stats({
      photos: photos({
        total: 1200,
        triageNotRequired: 200,
        triagePending: 300,
        triageInProgress: 100,
        triageClean: 500,
        triageFlagged: 100,
        quarantined: 12,
      }),
      weeks: {
        total: 40, awaitingPhotos: 2, notStarted: 3, inReview: 4,
        awaitingLead: 6, signedOff: 25, notRequired: 0,
      },
      locations: { total: 30, ignored: 2, approved: 25 },
    }));

    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(byKey.total.value).toBe("1,200");
    expect(byKey.total.detail).toBe("from 28 locations");
    expect(byKey.reviewed.value).toBe("600");
    expect(byKey.reviewed.detail).toBe("60% of 1,000 in the review pool");
    expect(byKey.awaiting.value).toBe("300");
    expect(byKey.awaiting.detail).toBe("plus 100 in progress");
    expect(byKey.flagged.detail).toBe("17% of reviewed photos");
    expect(byKey.quarantined.value).toBe("12");
    expect(byKey.weeks.value).toBe("25");
    expect(byKey.weeks.detail).toBe("6 weeks waiting on a lead");
  });

  it("reads sensibly on a fresh install with no photos", () => {
    const tiles = overviewTiles(stats());
    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(byKey.total.value).toBe("0");
    expect(byKey.reviewed.detail).toBe("nothing in the review pool yet");
    expect(byKey.awaiting.detail).toBe("no batches in progress");
    expect(byKey.flagged.detail).toBeNull();
    expect(byKey.weeks.detail).toBe("none waiting on a lead");
  });

  it("singularises the week and location counts", () => {
    const tiles = overviewTiles(stats({
      weeks: {
        total: 1, awaitingPhotos: 0, notStarted: 0, inReview: 0,
        awaitingLead: 1, signedOff: 0, notRequired: 0,
      },
      locations: { total: 1, ignored: 0, approved: 1 },
    }));
    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(byKey.total.detail).toBe("from 1 location");
    expect(byKey.weeks.detail).toBe("1 week waiting on a lead");
  });
});

describe("mapAdminOverviewStats", () => {
  it("maps the RPC's snake_case payload", () => {
    const mapped = mapAdminOverviewStats({
      photos: { total: 10, triage_clean: 4, rating_rated: 2, quarantined: 1 },
      weeks: { total: 3, signed_off: 1 },
      locations: { total: 2, ignored: 1, approved: 1 },
    });
    expect(mapped.photos.total).toBe(10);
    expect(mapped.photos.triageClean).toBe(4);
    expect(mapped.photos.ratingRated).toBe(2);
    expect(mapped.weeks.signedOff).toBe(1);
    expect(mapped.locations.approved).toBe(1);
  });

  it("defaults missing keys and blocks to zero", () => {
    const mapped = mapAdminOverviewStats({ photos: null, weeks: null, locations: null });
    expect(mapped.photos.total).toBe(0);
    expect(mapped.weeks.total).toBe(0);
    expect(mapped.locations.total).toBe(0);
  });
});
