import type { SupabaseClient } from "@supabase/supabase-js";

// Points ledger + rules client helpers. The ledger itself is written only by
// the trigger on triage_events (SECURITY DEFINER); UI reads aggregates via
// the user_points_totals view and updates the rule via /api/admin/points-rules.
// See spec/GAMIFICATION_SPEC.md.

export type PointsRule = {
  sourceKind: "triage_event";
  points: number;
  updatedAt: string;
};

export type UserPointsTotal = {
  userId: string;
  eventCount: number;
  totalPoints: number;
};

type RawRule = {
  source_kind: "triage_event";
  points: number;
  updated_at: string;
};

type RawTotal = {
  user_id: string;
  event_count: number;
  total_points: number;
};

export async function fetchTriagePointsRule(
  supabase: SupabaseClient,
): Promise<PointsRule> {
  const { data, error } = await supabase
    .from("points_rules")
    .select("source_kind, points, updated_at")
    .eq("source_kind", "triage_event")
    .single();
  if (error) throw error;
  const r = data as unknown as RawRule;
  return { sourceKind: r.source_kind, points: r.points, updatedAt: r.updated_at };
}

// PUT /api/admin/points-rules. Admin-only — RLS also enforces this at the
// DB layer.
export async function updateTriagePointsRule(points: number): Promise<PointsRule> {
  const res = await fetch("/api/admin/points-rules", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_kind: "triage_event", points }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to update points rule (${res.status})`);
  }
  const r = (await res.json()) as RawRule;
  return { sourceKind: r.source_kind, points: r.points, updatedAt: r.updated_at };
}

// Reviewer-scoped read. RLS limits the row to the caller; admins see all.
export async function fetchSelfPointsTotal(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserPointsTotal | null> {
  const { data, error } = await supabase
    .from("user_points_totals")
    .select("user_id, event_count, total_points")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as RawTotal;
  return { userId: r.user_id, eventCount: r.event_count, totalPoints: r.total_points };
}

// Admin-scoped read. Returns every reviewer's totals (RLS lets admins see all).
export async function fetchAllPointsTotals(
  supabase: SupabaseClient,
): Promise<UserPointsTotal[]> {
  const { data, error } = await supabase
    .from("user_points_totals")
    .select("user_id, event_count, total_points");
  if (error) throw error;
  return ((data ?? []) as unknown as RawTotal[]).map((r) => ({
    userId: r.user_id,
    eventCount: r.event_count,
    totalPoints: r.total_points,
  }));
}

// ─── My Stats helpers ──────────────────────────────────────────────────────

/** Ledger sources that represent a reviewer completing a photo review. */
export const REVIEW_POINTS_SOURCES = ["triage_event", "photo_rating_event"] as const;

export type WindowedTotal = {
  totalPoints: number;
  eventCount: number;
};

// Sum + count of ledger rows for one user within an optional time window.
// `sinceIso` filters `occurred_at >= sinceIso`; pass null for all-time.
export async function fetchSelfWindowedPoints(
  supabase: SupabaseClient,
  userId: string,
  sinceIso: string | null,
): Promise<WindowedTotal> {
  let q = supabase
    .from("points_ledger")
    .select("points")
    .eq("user_id", userId)
    .in("source_kind", [...REVIEW_POINTS_SOURCES]);
  if (sinceIso !== null) q = q.gte("occurred_at", sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as { points: number }[];
  let sum = 0;
  for (const r of rows) sum += r.points;
  return { totalPoints: sum, eventCount: rows.length };
}

export type WeeklyBreakdownRow = {
  campWeekId: string;
  weekName: string;
  startsOn: string;
  endsOn: string;
  locationName: string;
  totalPoints: number;
  eventCount: number;
  lastAt: string;
};

type RawLedgerRow = {
  source_id: string;
  source_kind: string;
  points: number;
  occurred_at: string;
};

type CampWeekEmbed = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  location: { name: string } | null;
};

type RawEventEmbed = {
  id: string;
  photo: { camp_week: CampWeekEmbed | null } | null;
};

const WEEK_SELECT =
  "id, photo:photos(camp_week:camp_weeks(id, name, starts_on, ends_on, location:locations(name)))";

// Per-week aggregate over the reviewer's ledger entries. Joins ledger →
// triage_events / photo_rating_events → photos → camp_weeks client-side.
export async function fetchSelfWeeklyBreakdown(
  supabase: SupabaseClient,
  userId: string,
): Promise<WeeklyBreakdownRow[]> {
  const { data: ledgerRaw, error: ledgerErr } = await supabase
    .from("points_ledger")
    .select("source_id, source_kind, points, occurred_at")
    .eq("user_id", userId)
    .in("source_kind", [...REVIEW_POINTS_SOURCES]);
  if (ledgerErr) throw ledgerErr;
  const ledger = (ledgerRaw ?? []) as unknown as RawLedgerRow[];
  if (ledger.length === 0) return [];

  const triageIds = ledger
    .filter((r) => r.source_kind === "triage_event")
    .map((r) => r.source_id);
  const ratingIds = ledger
    .filter((r) => r.source_kind === "photo_rating_event")
    .map((r) => r.source_id);

  const eventToWeek = new Map<string, CampWeekEmbed>();

  const embedWeeks = (events: RawEventEmbed[]) => {
    for (const e of events) {
      if (e.photo?.camp_week) eventToWeek.set(e.id, e.photo.camp_week);
    }
  };

  const loadTriageWeeks = async () => {
    const { data, error } = await supabase
      .from("triage_events")
      .select(WEEK_SELECT)
      .in("id", triageIds);
    if (error) throw error;
    embedWeeks((data ?? []) as unknown as RawEventEmbed[]);
  };

  const loadRatingWeeks = async () => {
    const { data, error } = await supabase
      .from("photo_rating_events")
      .select(WEEK_SELECT)
      .in("id", ratingIds);
    if (error) throw error;
    embedWeeks((data ?? []) as unknown as RawEventEmbed[]);
  };

  await Promise.all([
    triageIds.length > 0 ? loadTriageWeeks() : Promise.resolve(),
    ratingIds.length > 0 ? loadRatingWeeks() : Promise.resolve(),
  ]);

  type Agg = {
    campWeekId: string;
    weekName: string;
    startsOn: string;
    endsOn: string;
    locationName: string;
    totalPoints: number;
    eventCount: number;
    lastAtMs: number;
  };
  const weeks = new Map<string, Agg>();
  for (const row of ledger) {
    const week = eventToWeek.get(row.source_id);
    if (!week) continue; // event likely cascade-deleted with its photo
    const ts = Date.parse(row.occurred_at);
    const existing = weeks.get(week.id);
    if (existing) {
      existing.totalPoints += row.points;
      existing.eventCount += 1;
      if (Number.isFinite(ts) && ts > existing.lastAtMs) existing.lastAtMs = ts;
    } else {
      weeks.set(week.id, {
        campWeekId:   week.id,
        weekName:     week.name,
        startsOn:     week.starts_on,
        endsOn:       week.ends_on,
        locationName: week.location?.name ?? "Unknown location",
        totalPoints:  row.points,
        eventCount:   1,
        lastAtMs:     Number.isFinite(ts) ? ts : 0,
      });
    }
  }

  return Array.from(weeks.values())
    .sort((a, b) => b.lastAtMs - a.lastAtMs)
    .map((a) => ({
      campWeekId:   a.campWeekId,
      weekName:     a.weekName,
      startsOn:     a.startsOn,
      endsOn:       a.endsOn,
      locationName: a.locationName,
      totalPoints:  a.totalPoints,
      eventCount:   a.eventCount,
      lastAt:       new Date(a.lastAtMs).toISOString(),
    }));
}
