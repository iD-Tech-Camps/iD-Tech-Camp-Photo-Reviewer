// Seed the local Supabase stack with realistic data for smoke-testing
// phase 3 (location-approval UI).
//
// Usage (from project root):
//   node scripts/seed-local-dev.mjs
//
// Reads local stack credentials from .env.test.local. Creates:
//   - 1 senior user (dev-senior@local.test / local-dev-password)
//   - 1 reviewer user (dev-reviewer@local.test / local-dev-password)
//   - 3 locations across 1 division:
//       1. "Demo - Awaiting"  (unapproved, has pending photos)
//       2. "Demo - Approved"  (already approved, has the post-approve mix)
//       3. "Demo - Revoked"   (was approved, then revoked; photos back in queue)
//   - 1 camp_week per location in the current season
//   - ~6 photos per week
//   - 1 feedback event on the Awaiting location

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const envRaw = readFileSync(".env.test.local", "utf8");
const env = Object.fromEntries(
  envRaw
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SENIOR_EMAIL = "dev-senior@local.test";
const REVIEWER_EMAIL = "dev-reviewer@local.test";
const PASSWORD = "local-dev-password";

async function ensureUser(email, role) {
  const { data: list } = await sb.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email === email);
  let id = existing?.id;
  if (!id) {
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    id = data.user.id;
  }
  // handle_new_user trigger creates the profile; force the role.
  const { error: roleErr } = await sb.from("profiles").update({ role }).eq("id", id);
  if (roleErr) throw new Error(`profiles.update role ${email}: ${roleErr.message}`);
  return id;
}

async function clearPriorSeed() {
  // The locations → camp_weeks → photos FK chain doesn't cascade on delete
  // (matches the fixture teardown shape — see tests/fixtures.ts). Walk the
  // hierarchy explicitly so re-running the seed lands clean.
  const { data: locs } = await sb
    .from("locations")
    .select("id")
    .like("name", "Demo - %");
  const locIds = (locs ?? []).map((l) => l.id);
  if (locIds.length === 0) return;

  const { data: weeks } = await sb
    .from("camp_weeks")
    .select("id")
    .in("location_id", locIds);
  const weekIds = (weeks ?? []).map((w) => w.id);

  if (weekIds.length > 0) {
    await sb.from("photos").delete().in("camp_week_id", weekIds);
  }
  await sb.from("location_feedback_events").delete().in("location_id", locIds);
  await sb.from("location_approvals").delete().in("location_id", locIds);
  if (weekIds.length > 0) {
    await sb.from("camp_weeks").delete().in("id", weekIds);
  }
  await sb.from("locations").delete().in("id", locIds);
}

async function ensureDivision() {
  // Look up by smugmug_folder_id (unique), upsert by that key.
  const { data: existing } = await sb
    .from("divisions")
    .select("id")
    .eq("smugmug_folder_id", "demo-division")
    .maybeSingle();
  if (existing) return existing.id;
  const id = randomUUID();
  const { error } = await sb.from("divisions").insert({
    id,
    name: "Demo Division",
    smugmug_folder_id: "demo-division",
  });
  if (error) throw new Error(`division: ${error.message}`);
  return id;
}

async function ensureTriageConfig() {
  // Read the current triage_config. The view + RPCs filter approvals by
  // triage_config.season_first_week_start, so the seed has to use whatever
  // value is currently there (otherwise seeded approvals fall "out of
  // season" and surface as unapproved).
  const { data: cfg, error } = await sb
    .from("triage_config")
    .select("season_first_week_start, season_last_week_start")
    .eq("id", 1)
    .single();
  if (error || !cfg) {
    throw new Error(
      "triage_config row missing — run `npx supabase db reset` first to apply migrations.",
    );
  }
  // Make sure the demo week (today) falls inside the configured window. If
  // not, widen the window. We never narrow it — Admin Settings owns the
  // primary value.
  const today = new Date().toISOString().slice(0, 10);
  let { season_first_week_start: start, season_last_week_start: end } = cfg;
  if (today < start || today > end) {
    const widenedStart = today < start ? today : start;
    const widenedEnd = today > end ? today : end;
    await sb
      .from("triage_config")
      .update({
        season_first_week_start: widenedStart,
        season_last_week_start: widenedEnd,
      })
      .eq("id", 1);
    start = widenedStart;
    end = widenedEnd;
    console.log(`  widened season to [${start}, ${end}] to include today`);
  }
  return { seasonStart: start, seasonEnd: end };
}

async function seedLocation(divId, name, weekStartsOn, photoCount) {
  const locId = randomUUID();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { error: locErr } = await sb.from("locations").insert({
    id: locId,
    division_id: divId,
    name,
    smugmug_folder_id: `demo-${slug}`,
  });
  if (locErr) throw new Error(`location ${name}: ${locErr.message}`);

  const weekId = randomUUID();
  const start = new Date(weekStartsOn);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  const { error: weekErr } = await sb.from("camp_weeks").insert({
    id: weekId,
    location_id: locId,
    name: `Demo Week — ${name.replace("Demo - ", "")}`,
    smugmug_folder_id: `demo-w-${slug}`,
    starts_on: start.toISOString().slice(0, 10),
    ends_on: end.toISOString().slice(0, 10),
  });
  if (weekErr) throw new Error(`week ${name}: ${weekErr.message}`);

  const photoRows = Array.from({ length: photoCount }, (_, i) => ({
    id: randomUUID(),
    camp_week_id: weekId,
    smugmug_image_id: `demo-${slug}-photo-${i}`,
    captured_at: new Date(Date.now() - i * 3600_000).toISOString(),
    thumbnail_url: null,
    image_url: null,
  }));
  const { error: photoErr } = await sb.from("photos").insert(photoRows);
  if (photoErr) throw new Error(`photos ${name}: ${photoErr.message}`);

  return { locId, weekId };
}

async function main() {
  await clearPriorSeed();
  const { seasonStart } = await ensureTriageConfig();

  const seniorId = await ensureUser(SENIOR_EMAIL, "senior");
  const reviewerId = await ensureUser(REVIEWER_EMAIL, "reviewer");

  const divId = await ensureDivision();

  // Three locations with different states.
  const today = new Date().toISOString().slice(0, 10);
  const awaiting = await seedLocation(divId, "Demo - Awaiting", today, 6);
  const approved = await seedLocation(divId, "Demo - Approved", today, 6);
  const revoked = await seedLocation(divId, "Demo - Revoked", today, 6);

  // Approve the second location.
  await sb.from("location_approvals").insert({
    location_id: approved.locId,
    season_start: seasonStart,
    approved_by: seniorId,
  });

  // For the third location: approve then revoke, so it lands in "reopened".
  const { data: revokedRow } = await sb
    .from("location_approvals")
    .insert({
      location_id: revoked.locId,
      season_start: seasonStart,
      approved_by: seniorId,
    })
    .select("id")
    .single();
  await sb
    .from("location_approvals")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: seniorId,
      revocation_reason: "demo: re-review needed",
    })
    .eq("id", revokedRow.id);

  // A feedback event on the Awaiting location.
  await sb.from("location_feedback_events").insert({
    location_id: awaiting.locId,
    author_id: seniorId,
    body: "Day 1 looks good — keep an eye on the lanyards in the BB arena.",
  });

  console.log(`\nSeed complete.`);
  console.log(`  Senior:    ${SENIOR_EMAIL}  /  ${PASSWORD}`);
  console.log(`  Reviewer:  ${REVIEWER_EMAIL}  /  ${PASSWORD}`);
  console.log(`  Locations: Demo - Awaiting (pending),`);
  console.log(`             Demo - Approved (approved, photos drained to not_required),`);
  console.log(`             Demo - Revoked (approved then revoked → reopened state)`);
  console.log(`\nStart dev server with:`);
  console.log(`  NEXT_PUBLIC_SUPABASE_URL=${env.NEXT_PUBLIC_SUPABASE_URL} \\`);
  console.log(`  NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.NEXT_PUBLIC_SUPABASE_ANON_KEY} \\`);
  console.log(`  NEXT_PUBLIC_DEV_AUTH=1 npm run dev`);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
