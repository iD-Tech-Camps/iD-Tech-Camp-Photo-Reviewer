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
