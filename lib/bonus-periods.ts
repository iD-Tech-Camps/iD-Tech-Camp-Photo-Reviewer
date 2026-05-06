import type { SupabaseClient } from "@supabase/supabase-js";

export type BonusPeriodMode = "recurring" | "one-time";

// Camel-cased projection of the `bonus_periods` table (migration 17).
// Mirrors the BonusPeriod type that the SettingsProvider used while the
// schedule rode localStorage — same field names, same semantics, just
// plumbed through Supabase now. Keeping the shape stable means
// HomeScreen / ReviewScreen / Shell.tsx didn't have to change.
//
// Field-by-field semantics:
//   - mode = 'recurring' → reads days[] + startTime/endTime, ignores startAt/endAt
//   - mode = 'one-time'  → reads startAt/endAt, ignores days/start*/end*Time
// The DB constraints (`bonus_periods_recurring_complete` and
// `bonus_periods_onetime_complete`) enforce the not-applicable fields are
// either populated with their defaults or null per mode.
export type BonusPeriod = {
  id: string;
  label: string;
  mode: BonusPeriodMode;
  days: number[];
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  multiplier: number;
  enabled: boolean;
};

type RawBonusPeriodRow = {
  id: string;
  label: string;
  mode: BonusPeriodMode;
  days: number[] | null;
  start_time: string;
  end_time: string;
  start_at: string | null;
  end_at: string | null;
  multiplier: string | number;
  enabled: boolean;
};

const COLUMNS =
  "id, label, mode, days, start_time, end_time, start_at, end_at, multiplier, enabled";

function mapRow(r: RawBonusPeriodRow): BonusPeriod {
  return {
    id:         r.id,
    label:      r.label,
    mode:       r.mode,
    days:       r.days ?? [],
    startTime:  r.start_time,
    endTime:    r.end_time,
    startAt:    r.start_at ?? "",
    endAt:      r.end_at ?? "",
    // numeric(4,2) comes back as a string from PostgREST. Coerce to
    // number once on read so the consuming UI doesn't have to.
    multiplier: typeof r.multiplier === "string" ? parseFloat(r.multiplier) : r.multiplier,
    enabled:    r.enabled,
  };
}

// Fetch all bonus periods, ordered so the UI can render them in a stable
// way: enabled first (the ones reviewers can actually hit), then by
// multiplier desc (the most generous near the top), then by label so
// equal-multiplier rows stay grouped.
export async function fetchBonusPeriods(
  supabase: SupabaseClient,
): Promise<BonusPeriod[]> {
  const { data, error } = await supabase
    .from("bonus_periods")
    .select(COLUMNS)
    .order("enabled",    { ascending: false })
    .order("multiplier", { ascending: false })
    .order("label",      { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as RawBonusPeriodRow[]).map(mapRow);
}

// Build the row-payload for both insert and update. Splitting the two
// modes' columns keeps the payload sane — for a recurring row we never
// want to silently smuggle stale start_at/end_at values, and vice versa.
function toRowPayload(period: Partial<BonusPeriod> & { mode: BonusPeriodMode }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (period.label      !== undefined) out.label      = period.label ?? "";
  out.mode = period.mode;
  if (period.multiplier !== undefined) out.multiplier = period.multiplier;
  if (period.enabled    !== undefined) out.enabled    = period.enabled;

  if (period.mode === "recurring") {
    out.days       = period.days ?? [];
    out.start_time = period.startTime ?? "00:00";
    out.end_time   = period.endTime   ?? "00:00";
    // Reset one-time fields so a row that flipped modes doesn't keep
    // stale timestamps that would re-fire if mode flips back.
    out.start_at = null;
    out.end_at   = null;
  } else {
    // One-time. Pass through the timestamps as ISO strings; defaults
    // for the unused recurring columns satisfy the format check
    // constraints without affecting evaluation.
    out.start_at = period.startAt || null;
    out.end_at   = period.endAt   || null;
    out.days       = [];
    out.start_time = "00:00";
    out.end_time   = "00:00";
  }
  return out;
}

export async function createBonusPeriod(
  supabase: SupabaseClient,
  period: Omit<BonusPeriod, "id">,
): Promise<BonusPeriod> {
  const { data, error } = await supabase
    .from("bonus_periods")
    .insert(toRowPayload(period))
    .select(COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error("bonus_periods insert returned no row");
  return mapRow(data as unknown as RawBonusPeriodRow);
}

export async function updateBonusPeriod(
  supabase: SupabaseClient,
  id: string,
  period: Partial<BonusPeriod> & { mode: BonusPeriodMode },
): Promise<BonusPeriod> {
  const { data, error } = await supabase
    .from("bonus_periods")
    .update(toRowPayload(period))
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error("bonus_periods update returned no row");
  return mapRow(data as unknown as RawBonusPeriodRow);
}

// Lightweight enable/disable toggle. Use this from the row-level
// "enabled" switch — going through updateBonusPeriod would force the
// caller to re-supply the full row.
export async function setBonusPeriodEnabled(
  supabase: SupabaseClient,
  id: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("bonus_periods")
    .update({ enabled })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBonusPeriod(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("bonus_periods")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
