import type { SupabaseClient } from "@supabase/supabase-js";

// A weekly "location stopped uploading" alert. Display fields are snapshotted
// at detection time (see the upload_alerts migration) so history is stable.
export type UploadAlert = {
  id: string;
  locationId: string;
  campWeekId: string | null;
  weekStart: string;
  locationName: string;
  divisionName: string;
  weekLabel: string;
  detectedAt: string;
  dismissedAt: string | null;
  dismissedByName: string | null;
};

type UploadAlertRow = {
  id: string;
  location_id: string;
  camp_week_id: string | null;
  week_start: string;
  location_name: string;
  division_name: string;
  week_label: string;
  detected_at: string;
  dismissed_at: string | null;
  dismissed_by: string | null;
};

/**
 * Fetch upload alerts for the lead hub, split into the active feed (undismissed)
 * and dismissed history (most-recent first). One round trip for the rows plus a
 * lookup for dismisser names.
 */
export async function fetchUploadAlerts(
  supabase: SupabaseClient,
): Promise<{ active: UploadAlert[]; dismissed: UploadAlert[] }> {
  const { data, error } = await supabase
    .from("upload_alerts")
    .select(
      "id, location_id, camp_week_id, week_start, location_name, division_name, " +
        "week_label, detected_at, dismissed_at, dismissed_by",
    )
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as UploadAlertRow[];

  const dismisserIds = [
    ...new Set(rows.map((r) => r.dismissed_by).filter((x): x is string => !!x)),
  ];
  const namesById = new Map<string, string | null>();
  if (dismisserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", dismisserIds);
    for (const p of (profiles ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>) {
      namesById.set(p.id, p.full_name ?? p.email ?? null);
    }
  }

  const toAlert = (r: UploadAlertRow): UploadAlert => ({
    id: r.id,
    locationId: r.location_id,
    campWeekId: r.camp_week_id,
    weekStart: r.week_start,
    locationName: r.location_name,
    divisionName: r.division_name,
    weekLabel: r.week_label,
    detectedAt: r.detected_at,
    dismissedAt: r.dismissed_at,
    dismissedByName: r.dismissed_by ? namesById.get(r.dismissed_by) ?? null : null,
  });

  return {
    active: rows.filter((r) => !r.dismissed_at).map(toAlert),
    dismissed: rows.filter((r) => r.dismissed_at).map(toAlert),
  };
}

export async function dismissUploadAlert(alertId: string): Promise<void> {
  const res = await fetch(`/api/alerts/${alertId}/dismiss`, { method: "POST" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message ?? json.error ?? `dismiss failed (${res.status})`);
  }
}
