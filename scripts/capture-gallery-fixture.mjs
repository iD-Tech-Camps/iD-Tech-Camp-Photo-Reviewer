// One-time (and occasional-refresh) capture of a slice of rated photos from
// PROD into a LOCAL fixture file (.dev-seed/gallery-fixture.json, gitignored).
// This is the ONLY step that touches prod, and it's read-only. Day-to-day
// reseeding of the local DB reads the fixture, never prod — see
// lib/dev/gallery-seed.ts + the "Reseed dev data" dev-bar button.
//
//   node scripts/capture-gallery-fixture.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const PROD_URL = "https://xatxybwbjuusybfmwkbg.supabase.co";
const prod = createClient(PROD_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PHOTO_LIMIT = 400;

const die = (m, e) => { console.error(m, e); process.exit(1); };

console.log("Fetching rated photos from prod…");
const { data: photos, error: pErr } = await prod
  .from("photos")
  .select(
    "id, camp_week_id, smugmug_image_id, smugmug_url, image_url, thumbnail_url, captured_at, width, height, " +
      "camp_weeks!inner ( id, location_id, name, smugmug_folder_id, starts_on, ends_on, " +
      "locations!inner ( id, division_id, name, smugmug_folder_id, " +
      "divisions!inner ( id, name, smugmug_folder_id ) ) )",
  )
  .eq("rating_state", "rated")
  .eq("is_quarantined", false)
  .not("thumbnail_url", "is", null)
  .limit(PHOTO_LIMIT);
if (pErr) die("prod photos fetch failed", pErr);

const divisions = new Map(), locations = new Map(), weeks = new Map();
const photoRows = [];
for (const p of photos) {
  const w = p.camp_weeks, l = w?.locations, d = l?.divisions;
  if (!w || !l || !d) continue;
  divisions.set(d.id, { id: d.id, name: d.name, smugmug_folder_id: d.smugmug_folder_id });
  locations.set(l.id, { id: l.id, division_id: l.division_id, name: l.name, smugmug_folder_id: l.smugmug_folder_id });
  weeks.set(w.id, {
    id: w.id, location_id: w.location_id, name: w.name,
    smugmug_folder_id: w.smugmug_folder_id, starts_on: w.starts_on, ends_on: w.ends_on,
  });
  photoRows.push({
    id: p.id, camp_week_id: p.camp_week_id, smugmug_image_id: p.smugmug_image_id,
    smugmug_url: p.smugmug_url, image_url: p.image_url, thumbnail_url: p.thumbnail_url,
    captured_at: p.captured_at, width: p.width, height: p.height,
    rating: null, tagIds: [], ratedByEmail: null, ratedByName: null,
  });
}

console.log("Fetching prod rating events + reviewers…");
const photoIds = photoRows.map((p) => p.id);
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

// Chunk the .in() lookups — 400 UUIDs overflow the GET query-string limit.
const latest = new Map();
for (const batch of chunk(photoIds, 100)) {
  const { data: events, error } = await prod
    .from("photo_rating_events")
    .select("id, photo_id, rating, created_at, reviewer_id, profiles ( email, full_name )")
    .in("photo_id", batch)
    .order("created_at", { ascending: false });
  if (error) die("prod events fetch failed", error);
  for (const e of events ?? []) {
    if (!latest.has(e.photo_id)) latest.set(e.photo_id, e);
  }
}

const tagsByEvent = new Map();
const eventIds = [...latest.values()].map((e) => e.id);
for (const batch of chunk(eventIds, 100)) {
  const { data: prodTags, error } = await prod
    .from("photo_rating_event_tags")
    .select("event_id, tag_id")
    .in("event_id", batch);
  if (error) die("prod event tags fetch failed", error);
  for (const t of prodTags ?? []) {
    const list = tagsByEvent.get(t.event_id) ?? [];
    list.push(t.tag_id);
    tagsByEvent.set(t.event_id, list);
  }
}

for (const p of photoRows) {
  const e = latest.get(p.id);
  if (!e) continue;
  p.rating = e.rating;
  p.tagIds = tagsByEvent.get(e.id) ?? [];
  p.ratedByEmail = e.profiles?.email ?? null;
  p.ratedByName = e.profiles?.full_name ?? null;
}

const fixture = {
  capturedAt: new Date().toISOString(),
  divisions: [...divisions.values()],
  locations: [...locations.values()],
  weeks: [...weeks.values()],
  photos: photoRows,
};

mkdirSync(".dev-seed", { recursive: true });
writeFileSync(".dev-seed/gallery-fixture.json", JSON.stringify(fixture, null, 2));
console.log(
  `Wrote .dev-seed/gallery-fixture.json — ${photoRows.length} photos, ${weeks.size} weeks, ` +
    `${locations.size} locations, ${divisions.size} divisions.`,
);
