import type { SupabaseClient } from "@supabase/supabase-js";

export type TriageConfig = {
  firstWeekWindowStart: string;
  firstWeekWindowEnd: string;
  maxForTriagePerBurst: number;
  sampleBurstDow: number;
  sampleBurstHour: number;
  claimExpiryMinutes: number;
  updatedAt: string;
};

type RawRow = {
  first_week_window_start: string;
  first_week_window_end: string;
  max_for_triage_per_burst: number;
  sample_burst_dow: number;
  sample_burst_hour: number;
  claim_expiry_minutes: number;
  updated_at: string;
};

const COLUMNS =
  "first_week_window_start, first_week_window_end, max_for_triage_per_burst, " +
  "sample_burst_dow, sample_burst_hour, claim_expiry_minutes, updated_at";

function mapRow(r: RawRow): TriageConfig {
  return {
    firstWeekWindowStart: r.first_week_window_start,
    firstWeekWindowEnd: r.first_week_window_end,
    maxForTriagePerBurst: r.max_for_triage_per_burst,
    sampleBurstDow: r.sample_burst_dow,
    sampleBurstHour: r.sample_burst_hour,
    claimExpiryMinutes: r.claim_expiry_minutes,
    updatedAt: r.updated_at,
  };
}

export async function fetchTriageConfig(
  supabase: SupabaseClient,
): Promise<TriageConfig> {
  const { data, error } = await supabase
    .from("triage_config")
    .select(COLUMNS)
    .eq("id", 1)
    .single();
  if (error) throw error;
  if (!data) throw new Error("triage_config row missing");
  return mapRow(data as unknown as RawRow);
}

export type UpdateTriageConfigInput = {
  firstWeekWindowStart: string;
  firstWeekWindowEnd: string;
  maxForTriagePerBurst: number;
  sampleBurstDow: number;
  sampleBurstHour: number;
  claimExpiryMinutes: number;
};

export async function updateTriageConfig(
  supabase: SupabaseClient,
  input: UpdateTriageConfigInput,
): Promise<TriageConfig> {
  const { data, error } = await supabase
    .from("triage_config")
    .update({
      first_week_window_start: input.firstWeekWindowStart,
      first_week_window_end: input.firstWeekWindowEnd,
      max_for_triage_per_burst: input.maxForTriagePerBurst,
      sample_burst_dow: input.sampleBurstDow,
      sample_burst_hour: input.sampleBurstHour,
      claim_expiry_minutes: input.claimExpiryMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error("triage_config update returned no row");
  return mapRow(data as unknown as RawRow);
}

export async function resetAllSampleFlags(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase.rpc("triage_reset_sample_flags");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
