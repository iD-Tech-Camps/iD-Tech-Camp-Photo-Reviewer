import type { SupabaseClient } from "@supabase/supabase-js";

export type LocationApprovalStatus = "unapproved" | "approved" | "reopened";

export type LocationSummary = {
  id: string;
  name: string;
  divisionName: string;
  approvalStatus: LocationApprovalStatus;
  approvedAt: string | null;
  approvedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  firstWeekStart: string | null;
  totalPhotos: number;
  pendingCount: number;
  inProgressCount: number;
  flaggedCount: number;
  lastFeedbackAt: string | null;
  lastFeedbackAuthor: string | null;
};

export type LocationDetail = LocationSummary & {
  evergreenNotes: string | null;
};

export type LocationCampWeek = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  triageRole: string;
  triageState: string;
  totalPhotos: number;
  pendingCount: number;
  flaggedCount: number;
  signoffAt: string | null;
  signoffByName: string | null;
};

export type FeedbackEvent = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  authorEmail: string | null;
  campWeekId: string | null;
  campWeekName: string | null;
  tagIds: string[];
};

type LocationWithApprovalRow = {
  id: string;
  name: string;
  approval_id: string | null;
  approval_status: string;
  approved_at: string | null;
  revoked_at: string | null;
  approved_by: string | null;
  revoked_by: string | null;
  divisions: { name: string | null } | null;
};

type LocationCampWeekRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  triage_role: string;
  triage_state: string;
  signoff_at: string | null;
  signoff_by: string | null;
  signoff_profile: { full_name: string | null; email: string | null } | null;
  photos: Array<{ triage_state: string }>;
};

type FeedbackEventRow = {
  id: string;
  body: string;
  created_at: string;
  camp_week_id: string | null;
  author: { full_name: string | null; email: string | null } | null;
  camp_weeks: { name: string | null } | null;
  location_feedback_event_tags: Array<{ tag_id: string }>;
};

function pickRecentFeedback(
  rows: Array<{ created_at: string; location_id: string; author: { full_name: string | null; email: string | null } | null }>,
): Map<string, { createdAt: string; authorName: string | null }> {
  const byLoc = new Map<string, { createdAt: string; authorName: string | null }>();
  for (const r of rows) {
    const existing = byLoc.get(r.location_id);
    if (!existing || r.created_at > existing.createdAt) {
      byLoc.set(r.location_id, {
        createdAt: r.created_at,
        authorName: r.author?.full_name ?? r.author?.email ?? null,
      });
    }
  }
  return byLoc;
}

/**
 * Fetch every location with its current-season approval status, aggregated
 * photo counts at triage-eligible weeks, and most-recent feedback timestamp.
 * Drives the lead hub list.
 */
export async function fetchLocationSummaries(
  supabase: SupabaseClient,
): Promise<LocationSummary[]> {
  const { data: locs, error } = await supabase
    .from("locations_with_approval")
    .select(
      "id, name, approval_id, approval_status, approved_at, revoked_at, approved_by, revoked_by, " +
        "divisions ( name )",
    )
    .order("name", { ascending: true });
  if (error) throw error;
  const locations = (locs ?? []) as unknown as LocationWithApprovalRow[];
  if (locations.length === 0) return [];

  const locationIds = locations.map((l) => l.id);

  // Pull all camp_weeks at these locations that are triage-eligible, with
  // their photos joined. One round trip across all locations beats N+1.
  const { data: weeks, error: weekErr } = await supabase
    .from("camp_weeks")
    .select(
      "id, location_id, starts_on, triage_role, " +
        "photos ( triage_state )",
    )
    .in("location_id", locationIds)
    .in("triage_role", ["first_week", "second_week_recheck"]);
  if (weekErr) throw weekErr;

  type WeekAgg = {
    location_id: string;
    starts_on: string;
    photos: Array<{ triage_state: string }>;
  };
  const weekRows = (weeks ?? []) as unknown as WeekAgg[];

  type Bucket = {
    total: number;
    pending: number;
    inProgress: number;
    flagged: number;
    firstWeekStart: string | null;
  };
  const aggByLoc = new Map<string, Bucket>();
  for (const w of weekRows) {
    let bucket = aggByLoc.get(w.location_id);
    if (!bucket) {
      bucket = { total: 0, pending: 0, inProgress: 0, flagged: 0, firstWeekStart: null };
      aggByLoc.set(w.location_id, bucket);
    }
    for (const p of w.photos ?? []) {
      bucket.total += 1;
      if (p.triage_state === "pending") bucket.pending += 1;
      else if (p.triage_state === "in_progress") bucket.inProgress += 1;
      else if (p.triage_state === "flagged") bucket.flagged += 1;
    }
    if (!bucket.firstWeekStart || w.starts_on < bucket.firstWeekStart) {
      bucket.firstWeekStart = w.starts_on;
    }
  }

  // Feedback recency.
  const { data: feedback, error: fbErr } = await supabase
    .from("location_feedback_events")
    .select(
      "id, location_id, created_at, " +
        "author:profiles!location_feedback_events_author_id_fkey ( full_name, email )",
    )
    .in("location_id", locationIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (fbErr) throw fbErr;
  const recentFeedback = pickRecentFeedback(
    (feedback ?? []) as unknown as Array<{
      created_at: string;
      location_id: string;
      author: { full_name: string | null; email: string | null } | null;
    }>,
  );

  // Profile lookup for approver / revoker names.
  const profileIds = [
    ...new Set(locations.flatMap((l) => [l.approved_by, l.revoked_by]).filter((id): id is string => !!id)),
  ];
  const profilesById = new Map<string, { name: string | null }>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", profileIds);
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      profilesById.set(p.id, { name: p.full_name ?? p.email ?? null });
    }
  }

  return locations.map((l) => {
    const bucket = aggByLoc.get(l.id);
    const fb = recentFeedback.get(l.id);
    return {
      id: l.id,
      name: l.name,
      divisionName: l.divisions?.name ?? "—",
      approvalStatus: (l.approval_status as LocationApprovalStatus) ?? "unapproved",
      approvedAt: l.approved_at,
      approvedByName: l.approved_by ? profilesById.get(l.approved_by)?.name ?? null : null,
      revokedAt: l.revoked_at,
      revokedByName: l.revoked_by ? profilesById.get(l.revoked_by)?.name ?? null : null,
      firstWeekStart: bucket?.firstWeekStart ?? null,
      totalPhotos: bucket?.total ?? 0,
      pendingCount: bucket?.pending ?? 0,
      inProgressCount: bucket?.inProgress ?? 0,
      flaggedCount: bucket?.flagged ?? 0,
      lastFeedbackAt: fb?.createdAt ?? null,
      lastFeedbackAuthor: fb?.authorName ?? null,
    };
  });
}

export async function fetchLocationDetail(
  supabase: SupabaseClient,
  locationId: string,
): Promise<{ detail: LocationDetail; weeks: LocationCampWeek[]; feedback: FeedbackEvent[] }> {
  const [locRes, weeksRes, feedbackRes, notesRes] = await Promise.all([
    supabase
      .from("locations_with_approval")
      .select(
        "id, name, approval_id, approval_status, approved_at, revoked_at, approved_by, revoked_by, " +
          "divisions ( name )",
      )
      .eq("id", locationId)
      .single(),
    supabase
      .from("camp_weeks")
      .select(
        "id, name, starts_on, ends_on, triage_role, triage_state, signoff_at, signoff_by, " +
          "signoff_profile:profiles!camp_weeks_signoff_by_fkey ( full_name, email ), " +
          "photos ( triage_state )",
      )
      .eq("location_id", locationId)
      .order("starts_on", { ascending: true }),
    supabase
      .from("location_feedback_events")
      .select(
        "id, body, created_at, camp_week_id, " +
          "author:profiles!location_feedback_events_author_id_fkey ( full_name, email ), " +
          "camp_weeks ( name ), " +
          "location_feedback_event_tags ( tag_id )",
      )
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("locations")
      .select("evergreen_notes")
      .eq("id", locationId)
      .single(),
  ]);

  if (locRes.error) throw locRes.error;
  if (weeksRes.error) throw weeksRes.error;
  if (feedbackRes.error) throw feedbackRes.error;
  if (notesRes.error) throw notesRes.error;

  const locRow = locRes.data as unknown as LocationWithApprovalRow;
  const weekRows = (weeksRes.data ?? []) as unknown as LocationCampWeekRow[];
  const feedbackRows = (feedbackRes.data ?? []) as unknown as FeedbackEventRow[];
  const notesRow = notesRes.data as { evergreen_notes: string | null } | null;

  // Resolve approver / revoker names.
  const idsToResolve = [locRow.approved_by, locRow.revoked_by].filter(
    (id): id is string => !!id,
  );
  let approvedByName: string | null = null;
  let revokedByName: string | null = null;
  if (idsToResolve.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", idsToResolve);
    const map = new Map(
      ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)
        .map((p) => [p.id, p.full_name ?? p.email ?? null] as const),
    );
    approvedByName = locRow.approved_by ? map.get(locRow.approved_by) ?? null : null;
    revokedByName = locRow.revoked_by ? map.get(locRow.revoked_by) ?? null : null;
  }

  const weeks: LocationCampWeek[] = weekRows.map((w) => {
    let total = 0;
    let pending = 0;
    let flagged = 0;
    for (const p of w.photos ?? []) {
      total += 1;
      if (p.triage_state === "pending") pending += 1;
      else if (p.triage_state === "flagged") flagged += 1;
    }
    return {
      id: w.id,
      name: w.name,
      startsOn: w.starts_on,
      endsOn: w.ends_on,
      triageRole: w.triage_role,
      triageState: w.triage_state,
      totalPhotos: total,
      pendingCount: pending,
      flaggedCount: flagged,
      signoffAt: w.signoff_at,
      signoffByName: w.signoff_profile?.full_name ?? w.signoff_profile?.email ?? null,
    };
  });

  const aggTotals = weeks
    .filter((w) => w.triageRole !== "none")
    .reduce(
      (acc, w) => {
        acc.total += w.totalPhotos;
        acc.pending += w.pendingCount;
        acc.flagged += w.flaggedCount;
        return acc;
      },
      { total: 0, pending: 0, flagged: 0 },
    );
  const firstWeekStart =
    weeks.find((w) => w.triageRole !== "none")?.startsOn ?? null;

  const feedback: FeedbackEvent[] = feedbackRows.map((e) => ({
    id: e.id,
    body: e.body,
    createdAt: e.created_at,
    authorName: e.author?.full_name ?? e.author?.email ?? null,
    authorEmail: e.author?.email ?? null,
    campWeekId: e.camp_week_id,
    campWeekName: e.camp_weeks?.name ?? null,
    tagIds: (e.location_feedback_event_tags ?? []).map((t) => t.tag_id),
  }));

  const lastFeedback = feedback[0];

  const detail: LocationDetail = {
    id: locRow.id,
    name: locRow.name,
    divisionName: locRow.divisions?.name ?? "—",
    approvalStatus: (locRow.approval_status as LocationApprovalStatus) ?? "unapproved",
    approvedAt: locRow.approved_at,
    approvedByName,
    revokedAt: locRow.revoked_at,
    revokedByName,
    firstWeekStart,
    totalPhotos: aggTotals.total,
    pendingCount: aggTotals.pending,
    inProgressCount: 0,
    flaggedCount: aggTotals.flagged,
    lastFeedbackAt: lastFeedback?.createdAt ?? null,
    lastFeedbackAuthor: lastFeedback?.authorName ?? null,
    evergreenNotes: notesRow?.evergreen_notes ?? null,
  };

  return { detail, weeks, feedback };
}

export async function approveLocation(locationId: string): Promise<void> {
  const res = await fetch(`/api/locations/${locationId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message ?? json.error ?? `approve failed (${res.status})`);
  }
}

export async function revokeLocation(locationId: string, reason: string | null): Promise<void> {
  const res = await fetch(`/api/locations/${locationId}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message ?? json.error ?? `revoke failed (${res.status})`);
  }
}

export async function postFeedback(
  locationId: string,
  body: string,
  opts?: { campWeekId?: string | null; tagIds?: string[] },
): Promise<void> {
  const res = await fetch(`/api/locations/${locationId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      body,
      camp_week_id: opts?.campWeekId ?? null,
      tag_ids: opts?.tagIds ?? [],
    }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message ?? json.error ?? `feedback failed (${res.status})`);
  }
}
