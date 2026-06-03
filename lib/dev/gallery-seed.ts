import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// Dev-only: load the captured gallery fixture (.dev-seed/gallery-fixture.json)
// into the LOCAL database. Reads a static file — never touches prod. The
// fixture is produced once by scripts/capture-gallery-fixture.mjs.
//
// Idempotent: parents are upserted by id; rating events for the fixture photos
// are deleted and re-inserted so a reseed reflects the current fixture exactly.

export const DEV_EMAIL = "dev@idtech.com";
export const DEV_PASSWORD = "devpass123";

type Fixture = {
  divisions: { id: string; name: string; smugmug_folder_id: string }[];
  locations: { id: string; division_id: string; name: string; smugmug_folder_id: string }[];
  weeks: {
    id: string; location_id: string; name: string;
    smugmug_folder_id: string; starts_on: string; ends_on: string;
  }[];
  photos: {
    id: string; camp_week_id: string; smugmug_image_id: string;
    smugmug_url: string | null; image_url: string | null; thumbnail_url: string | null;
    captured_at: string | null; width: number | null; height: number | null;
    rating: number | null; tagIds: string[];
    ratedByEmail: string | null; ratedByName: string | null;
  }[];
};

export type SeedResult = {
  photos: number; weeks: number; locations: number; divisions: number;
  reviewers: number; events: number; tags: number;
};

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export async function seedGalleryFromFixture(service: SupabaseClient): Promise<SeedResult> {
  const file = path.join(process.cwd(), ".dev-seed", "gallery-fixture.json");
  let fixture: Fixture;
  try {
    fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
  } catch {
    throw new Error(
      "No fixture found at .dev-seed/gallery-fixture.json. Run `node scripts/capture-gallery-fixture.mjs` first.",
    );
  }

  const up = async (table: string, rows: object[]) => {
    for (const batch of chunk(rows, 200)) {
      const { error } = await service.from(table).upsert(batch, { onConflict: "id" });
      if (error) throw new Error(`upsert ${table}: ${error.message}`);
    }
  };

  await up("divisions", fixture.divisions);
  await up("locations", fixture.locations);
  await up("camp_weeks", fixture.weeks);
  await up(
    "photos",
    fixture.photos.map((p) => ({
      id: p.id, camp_week_id: p.camp_week_id, smugmug_image_id: p.smugmug_image_id,
      smugmug_url: p.smugmug_url, image_url: p.image_url, thumbnail_url: p.thumbnail_url,
      captured_at: p.captured_at, width: p.width, height: p.height,
    })),
  );

  // Ensure the single dev login exists.
  await ensureUser(service, DEV_EMAIL, "Dev User", "admin");

  // Recreate reviewer accounts referenced by the fixture so "rated by" shows
  // real names. createUser fires handle_new_user → profile row.
  const reviewerEmails = [...new Set(
    fixture.photos.map((p) => p.ratedByEmail).filter((e): e is string => !!e),
  )];
  const reviewerIdByEmail = new Map<string, string>();
  for (const p of fixture.photos) {
    if (!p.ratedByEmail || reviewerIdByEmail.has(p.ratedByEmail)) continue;
    const id = await ensureUser(service, p.ratedByEmail, p.ratedByName, "reviewer");
    reviewerIdByEmail.set(p.ratedByEmail, id);
  }
  const devId = reviewerIdByEmail.get(DEV_EMAIL) ?? (await ensureUser(service, DEV_EMAIL, "Dev User", "admin"));

  // Wipe + re-insert rating events for the fixture photos (clean reseed).
  const photoIds = fixture.photos.map((p) => p.id);
  for (const batch of chunk(photoIds, 200)) {
    const { error } = await service.from("photo_rating_events").delete().in("photo_id", batch);
    if (error) throw new Error(`clear events: ${error.message}`);
  }

  const { data: localTags } = await service.from("tags").select("id");
  const localTagIds = new Set((localTags ?? []).map((t) => (t as { id: string }).id));

  const eventRows = fixture.photos
    .filter((p) => p.rating != null)
    .map((p) => ({
      photo_id: p.id,
      reviewer_id: (p.ratedByEmail && reviewerIdByEmail.get(p.ratedByEmail)) || devId,
      claim_id: null,
      rating: p.rating,
      quarantine_intent: false,
    }));

  const eventIdByPhoto = new Map<string, string>();
  for (const batch of chunk(eventRows, 200)) {
    const { data, error } = await service
      .from("photo_rating_events")
      .insert(batch)
      .select("id, photo_id");
    if (error) throw new Error(`insert events: ${error.message}`);
    for (const r of data as Array<{ id: string; photo_id: string }>) eventIdByPhoto.set(r.photo_id, r.id);
  }

  const tagRows: { event_id: string; tag_id: string }[] = [];
  for (const p of fixture.photos) {
    const evId = eventIdByPhoto.get(p.id);
    if (!evId) continue;
    for (const tagId of p.tagIds) {
      if (localTagIds.has(tagId)) tagRows.push({ event_id: evId, tag_id: tagId });
    }
  }
  for (const batch of chunk(tagRows, 200)) {
    const { error } = await service.from("photo_rating_event_tags").insert(batch);
    if (error) throw new Error(`insert event tags: ${error.message}`);
  }

  return {
    photos: fixture.photos.length, weeks: fixture.weeks.length,
    locations: fixture.locations.length, divisions: fixture.divisions.length,
    reviewers: reviewerEmails.length, events: eventRows.length, tags: tagRows.length,
  };
}

// Create the auth user if missing (idempotent) and return its id; ensure the
// profile carries the desired role + name.
async function ensureUser(
  service: SupabaseClient,
  email: string,
  fullName: string | null,
  role: "reviewer" | "senior" | "admin",
): Promise<string> {
  let id: string | undefined;
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  });
  if (created?.user) {
    id = created.user.id;
  } else if (error && /already|registered|exists/i.test(error.message)) {
    const { data: list } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = (list?.users ?? []) as Array<{ id: string; email?: string }>;
    id = users.find((u) => u.email === email)?.id;
  } else if (error) {
    throw new Error(`createUser ${email}: ${error.message}`);
  }
  if (!id) throw new Error(`could not resolve user id for ${email}`);

  const { error: profErr } = await service
    .from("profiles")
    .upsert({ id, email, full_name: fullName, role }, { onConflict: "id" });
  if (profErr) throw new Error(`profile upsert ${email}: ${profErr.message}`);
  return id;
}
