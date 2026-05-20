import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export type FixtureUser = { id: string; email: string; role: "reviewer" | "senior" | "admin" };

export type Fixture = {
  prefix: string;
  reviewer: FixtureUser;
  senior: FixtureUser;
  admin: FixtureUser;
  divisionId: string;
  locationId: string;
  campWeekId: string;
  photoIds: string[];
  tagIds: string[];
};

const SEASON_FIRST_WEEK_START = "2026-05-24";
const SEASON_LAST_WEEK_START = "2026-08-09";

export async function seed(opts?: { photos?: number; tags?: number }): Promise<Fixture> {
  const supabase = service();
  const prefix = `vitest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const photosCount = opts?.photos ?? 3;
  const tagsCount = opts?.tags ?? 2;

  await supabase
    .from("triage_config")
    .upsert({
      id: 1,
      season_first_week_start: SEASON_FIRST_WEEK_START,
      season_last_week_start: SEASON_LAST_WEEK_START,
    });

  const reviewer = await ensureUser(supabase, `${prefix}-reviewer@test.local`, "reviewer");
  const senior = await ensureUser(supabase, `${prefix}-senior@test.local`, "senior");
  const admin = await ensureUser(supabase, `${prefix}-admin@test.local`, "admin");

  const divisionId = randomUUID();
  const { error: divErr } = await supabase
    .from("divisions")
    .insert({ id: divisionId, name: `${prefix}-div`, smugmug_folder_id: `${prefix}-div` });
  if (divErr) throw new Error(`seed divisions: ${divErr.message}`);

  const locationId = randomUUID();
  const { error: locErr } = await supabase.from("locations").insert({
    id: locationId,
    division_id: divisionId,
    name: `${prefix}-loc`,
    smugmug_folder_id: `${prefix}-loc`,
  });
  if (locErr) throw new Error(`seed locations: ${locErr.message}`);

  const campWeekId = randomUUID();
  const { error: weekErr } = await supabase.from("camp_weeks").insert({
    id: campWeekId,
    location_id: locationId,
    name: `${prefix}-week1`,
    smugmug_folder_id: `${prefix}-w1`,
    starts_on: "2026-06-01",
    ends_on: "2026-06-05",
  });
  if (weekErr) throw new Error(`seed camp_weeks: ${weekErr.message}`);

  const photoIds: string[] = [];
  if (photosCount > 0) {
    const rows = Array.from({ length: photosCount }, (_, i) => ({
      id: randomUUID(),
      camp_week_id: campWeekId,
      smugmug_image_id: `${prefix}-photo-${i}`,
      captured_at: new Date(`2026-06-01T0${i % 9}:00:00Z`).toISOString(),
    }));
    const { error } = await supabase.from("photos").insert(rows);
    if (error) throw new Error(`seed photos: ${error.message}`);
    photoIds.push(...rows.map((r) => r.id));
  }

  const tagIds: string[] = [];
  for (let i = 0; i < tagsCount; i++) {
    const id = `${prefix}-tag-${i}`;
    const { error } = await supabase.from("tags").insert({
      id,
      label: `${prefix} tag ${i}`,
      display_order: 900 + i,
      active: true,
      purposes: ["quality_flag"],
    });
    if (error) throw new Error(`seed tags: ${error.message}`);
    tagIds.push(id);
  }

  return { prefix, reviewer, senior, admin, divisionId, locationId, campWeekId, photoIds, tagIds };
}

export async function teardown(f: Fixture): Promise<void> {
  const supabase = service();
  // points_ledger.user_id → profiles.id is ON DELETE RESTRICT (audit log),
  // so ledger rows must be wiped before the auth-user delete cascades into
  // profiles. Clean up by user_id since the trigger writes one ledger row
  // per clean/flag triage_event.
  await supabase
    .from("points_ledger")
    .delete()
    .in("user_id", [f.reviewer.id, f.senior.id, f.admin.id]);
  await supabase.from("triage_events").delete().in("reviewer_id", [f.reviewer.id, f.senior.id, f.admin.id]);
  await supabase.from("triage_claims").delete().in("reviewer_id", [f.reviewer.id, f.senior.id, f.admin.id]);
  await supabase.from("photo_rating_events").delete().in("reviewer_id", [f.reviewer.id, f.senior.id, f.admin.id]);
  await supabase.from("photo_rating_claims").delete().in("reviewer_id", [f.reviewer.id, f.senior.id, f.admin.id]);
  await supabase.from("camp_week_senior_tags").delete().eq("camp_week_id", f.campWeekId);
  await supabase.from("photos").delete().eq("camp_week_id", f.campWeekId);
  await supabase.from("camp_weeks").delete().eq("id", f.campWeekId);
  await supabase.from("locations").delete().eq("id", f.locationId);
  await supabase.from("divisions").delete().eq("id", f.divisionId);
  await supabase.from("tags").delete().in("id", f.tagIds);
  for (const id of [f.reviewer.id, f.senior.id, f.admin.id]) {
    await supabase.auth.admin.deleteUser(id).catch(() => {});
  }
}

async function ensureUser(
  supabase: SupabaseClient,
  email: string,
  role: "reviewer" | "senior" | "admin",
): Promise<FixtureUser> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "vitest-pw-vitest-pw",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`auth.admin.createUser(${email}): ${error?.message ?? "no user"}`);
  }
  const id = data.user.id;

  // handle_new_user trigger inserts the profile; force the role.
  const { error: roleErr } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (roleErr) throw new Error(`profiles.update role for ${email}: ${roleErr.message}`);

  return { id, email, role };
}
