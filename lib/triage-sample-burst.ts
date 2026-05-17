import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function runSampleBurst(
  supabase: SupabaseClient,
): Promise<{ weeksTouched: number; photosMarked: number }> {
  const { data: cfg, error: cfgErr } = await supabase
    .from("triage_config")
    .select("max_for_triage_per_burst")
    .eq("id", 1)
    .single();
  if (cfgErr || !cfg) throw new Error("triage_config missing");

  const budget = cfg.max_for_triage_per_burst as number;

  const { data: weeks, error: wErr } = await supabase
    .from("camp_weeks")
    .select("id")
    .neq("triage_role", "none")
    .in("triage_state", ["photos_in", "triage_in_progress", "triage_done", "senior_review"]);
  if (wErr) throw wErr;

  const weekIds = (weeks ?? []).map((w) => (w as { id: string }).id);
  if (weekIds.length === 0) return { weeksTouched: 0, photosMarked: 0 };

  type WeekPool = { id: string; unsampled: string[] };
  const pools: WeekPool[] = [];

  for (const wid of weekIds) {
    const { data: photos, error } = await supabase
      .from("photos")
      .select("id")
      .eq("camp_week_id", wid)
      .in("triage_state", ["pending", "in_progress"])
      .eq("sampled_for_burst", false)
      .order("captured_at", { ascending: true });
    if (error) throw error;
    const ids = (photos ?? []).map((p) => (p as { id: string }).id);
    if (ids.length > 0) pools.push({ id: wid, unsampled: ids });
  }

  let remaining = budget;
  const active = [...pools];
  const quotas = new Map<string, number>();

  while (active.length > 0 && remaining > 0) {
    const fairShare = Math.floor(remaining / active.length);
    if (fairShare === 0) {
      for (const w of active.sort((a, b) => a.id.localeCompare(b.id))) {
        if (remaining <= 0) break;
        quotas.set(w.id, (quotas.get(w.id) ?? 0) + 1);
        remaining -= 1;
      }
      break;
    }

    let anyCapped = false;
    const nextActive: WeekPool[] = [];
    for (const w of active) {
      const cap = w.unsampled.length - (quotas.get(w.id) ?? 0);
      const take = Math.min(fairShare, cap);
      quotas.set(w.id, (quotas.get(w.id) ?? 0) + take);
      remaining -= take;
      if (cap < fairShare) {
        anyCapped = true;
      } else {
        nextActive.push(w);
      }
    }
    if (!anyCapped) break;
    active.length = 0;
    active.push(...nextActive);
  }

  let photosMarked = 0;
  let weeksTouched = 0;

  for (const w of pools) {
    const q = quotas.get(w.id) ?? 0;
    if (q <= 0) continue;
    weeksTouched += 1;
    const n = w.unsampled.length;
    const bucketSize = Math.max(1, Math.ceil(n / q));
    const picks: string[] = [];
    for (let i = 0; i < q && i * bucketSize < n; i++) {
      picks.push(w.unsampled[i * bucketSize]);
    }
    if (picks.length > 0) {
      const { error } = await supabase
        .from("photos")
        .update({ sampled_for_burst: true })
        .in("id", picks);
      if (error) throw error;
      photosMarked += picks.length;
    }
  }

  return { weeksTouched, photosMarked };
}

export function shouldRunScheduledBurst(
  dow: number,
  hour: number,
  now = new Date(),
): boolean {
  return now.getUTCDay() === dow && now.getUTCHours() === hour;
}
