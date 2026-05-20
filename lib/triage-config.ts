import type { SupabaseClient } from "@supabase/supabase-js";

export type TriageConfig = {
  seasonFirstWeekStart: string;
  seasonLastWeekStart: string;
  maxForTriagePerBurst: number;
  batchSize: number;
  claimExpiryMinutes: number;
  updatedAt: string;
};

type RawRow = {
  season_first_week_start: string;
  season_last_week_start: string;
  max_for_triage_per_burst: number;
  batch_size: number;
  claim_expiry_minutes: number;
  updated_at: string;
};

const COLUMNS =
  "season_first_week_start, season_last_week_start, max_for_triage_per_burst, " +
  "batch_size, claim_expiry_minutes, updated_at";

function mapRow(r: RawRow): TriageConfig {
  return {
    seasonFirstWeekStart: r.season_first_week_start,
    seasonLastWeekStart: r.season_last_week_start,
    maxForTriagePerBurst: r.max_for_triage_per_burst,
    batchSize: r.batch_size,
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
  seasonFirstWeekStart: string;
  seasonLastWeekStart: string;
  maxForTriagePerBurst: number;
  batchSize: number;
  claimExpiryMinutes: number;
};

export async function updateTriageConfig(
  supabase: SupabaseClient,
  input: UpdateTriageConfigInput,
): Promise<TriageConfig> {
  const { data, error } = await supabase
    .from("triage_config")
    .update({
      season_first_week_start: input.seasonFirstWeekStart,
      season_last_week_start: input.seasonLastWeekStart,
      max_for_triage_per_burst: input.maxForTriagePerBurst,
      batch_size: input.batchSize,
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
