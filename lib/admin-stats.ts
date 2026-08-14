import type { SupabaseClient } from "@supabase/supabase-js";

// App-wide counters for Admin → Overview. The numbers come back from the
// `admin_overview_stats()` RPC (migration 51) as one jsonb blob so the screen
// makes a single round trip instead of ~20 exact-count head requests.
//
// Everything below the fetch is pure so it can be unit-tested without a DB.

export type PhotoStats = {
  total: number;
  triageNotRequired: number;
  triagePending: number;
  triageInProgress: number;
  triageClean: number;
  triageFlagged: number;
  triageDeleted: number;
  ratingNotRequired: number;
  ratingPending: number;
  ratingInProgress: number;
  ratingRated: number;
  quarantined: number;
};

export type WeekStats = {
  total: number;
  awaitingPhotos: number;
  notStarted: number;
  inReview: number;
  awaitingLead: number;
  signedOff: number;
  notRequired: number;
};

export type LocationStats = {
  total: number;
  ignored: number;
  approved: number;
};

export type AdminOverviewStats = {
  photos: PhotoStats;
  weeks: WeekStats;
  locations: LocationStats;
};

type RawStats = {
  photos: Record<string, number | null> | null;
  weeks: Record<string, number | null> | null;
  locations: Record<string, number | null> | null;
};

// jsonb numbers arrive as JS numbers, but an empty table still yields 0 rather
// than null — the coalesce is belt-and-braces against a key being absent if the
// RPC ever gains a field the deployed client doesn't know about yet.
const n = (src: Record<string, number | null> | null, key: string): number => {
  const v = src?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

export function mapAdminOverviewStats(raw: RawStats): AdminOverviewStats {
  const p = raw?.photos ?? null;
  const w = raw?.weeks ?? null;
  const l = raw?.locations ?? null;
  return {
    photos: {
      total:             n(p, "total"),
      triageNotRequired: n(p, "triage_not_required"),
      triagePending:     n(p, "triage_pending"),
      triageInProgress:  n(p, "triage_in_progress"),
      triageClean:       n(p, "triage_clean"),
      triageFlagged:     n(p, "triage_flagged"),
      triageDeleted:     n(p, "triage_deleted"),
      ratingNotRequired: n(p, "rating_not_required"),
      ratingPending:     n(p, "rating_pending"),
      ratingInProgress:  n(p, "rating_in_progress"),
      ratingRated:       n(p, "rating_rated"),
      quarantined:       n(p, "quarantined"),
    },
    weeks: {
      total:          n(w, "total"),
      awaitingPhotos: n(w, "awaiting_photos"),
      notStarted:     n(w, "not_started"),
      inReview:       n(w, "in_review"),
      awaitingLead:   n(w, "awaiting_lead"),
      signedOff:      n(w, "signed_off"),
      notRequired:    n(w, "not_required"),
    },
    locations: {
      total:    n(l, "total"),
      ignored:  n(l, "ignored"),
      approved: n(l, "approved"),
    },
  };
}

export async function fetchAdminOverviewStats(
  supabase: SupabaseClient,
): Promise<AdminOverviewStats> {
  const { data, error } = await supabase.rpc("admin_overview_stats");
  if (error) throw error;
  return mapAdminOverviewStats((data ?? {}) as RawStats);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation — pure. See tests/unit/admin-stats.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole-percent share, floored so a pipeline with work left never reads 100%
 * and one with any progress never reads 0%. Both round-offs actively mislead
 * on a progress meter, which is the one place the number gets trusted.
 */
export function sharePct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  const exact = (part / whole) * 100;
  if (exact >= 100) return 100;
  if (exact <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(exact)));
}

/** Comma-grouped up to 999,999; compact above that so a tile never wraps. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  return value.toLocaleString("en-US");
}

/** Design-system token a meter segment paints itself with. */
export type SegmentTone = "moss" | "sun" | "rose" | "lake" | "neutral";

export type MeterSegment = {
  key: string;
  label: string;
  count: number;
  tone: SegmentTone;
};

export type Meter = {
  title: string;
  /** Photos actually in this pipeline — the meter's denominator. */
  inScope: number;
  /** Terminal (finished) photos within `inScope`. */
  done: number;
  donePct: number;
  segments: MeterSegment[];
  /** Photos deliberately outside the pipeline, reported beside the meter. */
  outOfScope: number;
};

/**
 * Camp Quality Review pipeline. `not_required` photos are excluded from the
 * denominator rather than shown as an unfinished segment — they're weeks
 * outside the sample or locations that were never approved, so counting them
 * as "not reviewed" would make a finished season look permanently stalled.
 * `deleted` is terminal (a lead removed the photo), so it counts as done.
 */
export function qualityMeter(p: PhotoStats): Meter {
  const done = p.triageClean + p.triageFlagged + p.triageDeleted;
  const inScope = done + p.triageInProgress + p.triagePending;
  return {
    title: "Camp Quality Review",
    inScope,
    done,
    donePct: sharePct(done, inScope),
    outOfScope: p.triageNotRequired,
    segments: [
      { key: "clean",       label: "Cleared",         count: p.triageClean,      tone: "moss" },
      { key: "flagged",     label: "Flagged",         count: p.triageFlagged,    tone: "sun" },
      { key: "deleted",     label: "Deleted",         count: p.triageDeleted,    tone: "rose" },
      { key: "in_progress", label: "In progress",     count: p.triageInProgress, tone: "lake" },
      { key: "pending",     label: "Awaiting review", count: p.triagePending,    tone: "neutral" },
    ],
  };
}

/** Camp Photo Review (star rating) pipeline. Same scoping rule as above. */
export function ratingMeter(p: PhotoStats): Meter {
  const done = p.ratingRated;
  const inScope = done + p.ratingInProgress + p.ratingPending;
  return {
    title: "Camp Photo Review",
    inScope,
    done,
    donePct: sharePct(done, inScope),
    outOfScope: p.ratingNotRequired,
    segments: [
      { key: "rated",       label: "Rated",           count: p.ratingRated,      tone: "moss" },
      { key: "in_progress", label: "In progress",     count: p.ratingInProgress, tone: "lake" },
      { key: "pending",     label: "Awaiting rating", count: p.ratingPending,    tone: "neutral" },
    ],
  };
}

export type StatTile = {
  key: string;
  label: string;
  value: string;
  /** Secondary line. Null when there's nothing worth saying. */
  detail: string | null;
};

const plural = (count: number, one: string, many: string) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

export function overviewTiles(s: AdminOverviewStats): StatTile[] {
  const { photos, weeks, locations } = s;
  const quality = qualityMeter(photos);
  const activeLocations = locations.total - locations.ignored;

  return [
    {
      key: "total",
      label: "Photos synced",
      value: formatCount(photos.total),
      detail: `from ${plural(activeLocations, "location", "locations")}`,
    },
    {
      key: "reviewed",
      label: "Reviewed",
      value: formatCount(quality.done),
      detail: quality.inScope > 0
        ? `${quality.donePct}% of ${formatCount(quality.inScope)} in the review pool`
        : "nothing in the review pool yet",
    },
    {
      key: "awaiting",
      label: "Awaiting review",
      value: formatCount(photos.triagePending),
      detail: photos.triageInProgress > 0
        ? `plus ${formatCount(photos.triageInProgress)} in progress`
        : "no batches in progress",
    },
    {
      key: "flagged",
      label: "Issues flagged",
      value: formatCount(photos.triageFlagged),
      detail: quality.done > 0
        ? `${sharePct(photos.triageFlagged, quality.done)}% of reviewed photos`
        : null,
    },
    {
      key: "quarantined",
      label: "Quarantined",
      value: formatCount(photos.quarantined),
      detail: "held back from the photo library",
    },
    {
      key: "weeks",
      label: "Weeks signed off",
      value: formatCount(weeks.signedOff),
      detail: weeks.awaitingLead > 0
        ? `${plural(weeks.awaitingLead, "week", "weeks")} waiting on a lead`
        : "none waiting on a lead",
    },
  ];
}
