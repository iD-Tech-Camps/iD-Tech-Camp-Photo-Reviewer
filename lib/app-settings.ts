import type { SupabaseClient } from "@supabase/supabase-js";

// Persisted shape for the branding slice of `app_settings`. The five
// reviewer-copy columns (home_greeting, home_subtitle, completion_*,
// empty_queue_message) were dropped in migration 26 — they templated the
// marketing-review batch UX, which no longer exists. New triage copy
// fields (if any) get their own keys when they land.
//
// Keys mirror the camelCase the SettingsProvider uses; this file is the
// single place that maps between snake_case columns and the runtime
// shape.
export type DbAppSettings = {
  brandName: string;
  brandTagline: string;
  brandMark: string;
  supportEmail: string;
  // Brand color — the only "appearance" knob still global. Theme moved to
  // profiles in step 7.7c (per-user); density was dropped (never wired).
  accent: "sun" | "lake" | "moss" | "rose";
  // Storage path of the admin-uploaded favicon (in the `branding-assets`
  // bucket). NULL = no favicon configured; the layout emits no icon link.
  faviconStoragePath: string | null;
};

type RawAppSettingsRow = {
  brand_name: string | null;
  brand_tagline: string | null;
  brand_mark: string | null;
  support_email: string;
  accent: "sun" | "lake" | "moss" | "rose";
  favicon_storage_path: string | null;
};

const COLUMNS =
  "brand_name, brand_tagline, brand_mark, " +
  "support_email, accent, favicon_storage_path";

// Bucket holding admin-uploaded brand artifacts (favicon today, possibly
// header logo + login splash later). See migration 19.
export const BRANDING_BUCKET = "branding-assets";

// Resolve a public URL for an object in the branding-assets bucket. Goes
// through the SDK helper so the URL format stays owned by the SDK rather
// than hand-built strings.
export function brandingAssetUrl(
  supabase: SupabaseClient,
  path: string,
): string {
  return supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}

function mapRow(r: RawAppSettingsRow): DbAppSettings {
  return {
    // brand_* were nullable in migration 7 and remain so. Coerce to "" on
    // read so callers don't have to null-check; admins can blank them in
    // the UI which writes empty string back through.
    brandName:          r.brand_name ?? "",
    brandTagline:       r.brand_tagline ?? "",
    brandMark:          r.brand_mark ?? "",
    supportEmail:       r.support_email,
    accent:             r.accent,
    faviconStoragePath: r.favicon_storage_path,
  };
}

// Read the singleton settings row. Returns null if the row is missing
// (which would be a fresh database — the migration seeds it, so this
// branch should only fire in tests that scrub app_settings).
export async function fetchAppSettings(
  supabase: SupabaseClient,
): Promise<DbAppSettings | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select(COLUMNS)
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapRow(data as unknown as RawAppSettingsRow);
}

// Convert a partial camelCase patch from the UI into the snake_case shape
// the DB expects. Undefined keys are skipped (only changed fields are
// written), so a button that only edits `accent` doesn't roundtrip every
// other column.
function toRowPatch(patch: Partial<DbAppSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.brandName          !== undefined) out.brand_name           = patch.brandName;
  if (patch.brandTagline       !== undefined) out.brand_tagline        = patch.brandTagline;
  if (patch.brandMark          !== undefined) out.brand_mark           = patch.brandMark;
  if (patch.supportEmail       !== undefined) out.support_email        = patch.supportEmail;
  if (patch.accent             !== undefined) out.accent               = patch.accent;
  if (patch.faviconStoragePath !== undefined) out.favicon_storage_path = patch.faviconStoragePath;
  return out;
}

// Admin-only write through `app_settings_write_admin` RLS (migration 9).
// Caller should be an admin; non-admins get rejected at the policy layer.
// Returns the merged row so the SettingsProvider can replace state with
// the canonical post-write values.
export async function updateAppSettings(
  supabase: SupabaseClient,
  patch: Partial<DbAppSettings>,
): Promise<DbAppSettings> {
  const rowPatch = toRowPatch(patch);
  // Bump updated_at so any future "settings recently changed" UI works.
  rowPatch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("app_settings")
    .update(rowPatch)
    .eq("id", 1)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("app_settings update returned no row");
  return mapRow(data as unknown as RawAppSettingsRow);
}

// ── Favicon upload / remove ────────────────────────────────────────────────
// The favicon lives in the branding-assets bucket; `app_settings` stores
// only the object path. Upload/remove are split out from updateAppSettings
// because they need to coordinate two layers (storage + table) and have
// distinct cleanup semantics.

// Generate a unique storage path for a new favicon upload. UUID keeps
// paths opaque (no collisions, fresh URL on every replace so browsers
// don't serve stale cached bytes), with `.png` baked in since the upload
// UI restricts the picker to PNG.
function generateFaviconPath(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `favicon-${uuid}.png`;
}

// Upload a new favicon, swap the column to point at it, then best-effort
// remove the previous file. Order matters: if the upload fails the row is
// untouched; if the row update fails we drop the just-uploaded file so
// the bucket doesn't accumulate orphans; old-file deletion is post-row-
// update so a row never points at a missing file mid-failure.
export async function uploadFavicon(
  supabase: SupabaseClient,
  file: File,
): Promise<DbAppSettings> {
  const { data: existing, error: existingErr } = await supabase
    .from("app_settings")
    .select("favicon_storage_path")
    .eq("id", 1)
    .single();
  if (existingErr) throw existingErr;
  const oldPath =
    (existing as { favicon_storage_path: string | null } | null)
      ?.favicon_storage_path ?? null;

  const newPath = generateFaviconPath();
  const { error: uploadError } = await supabase
    .storage
    .from(BRANDING_BUCKET)
    .upload(newPath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/png",
    });
  if (uploadError) throw uploadError;

  let updated: DbAppSettings;
  try {
    updated = await updateAppSettings(supabase, { faviconStoragePath: newPath });
  } catch (err) {
    await supabase.storage.from(BRANDING_BUCKET).remove([newPath]).catch(() => {});
    throw err;
  }

  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from(BRANDING_BUCKET).remove([oldPath]).catch((err) => {
      console.warn("[app-settings] failed to delete old favicon", oldPath, err);
    });
  }

  return updated;
}

// NULL the column first, then best-effort remove the file. Reverse order
// would risk the row pointing at a missing file if the storage delete
// succeeded but the row update failed.
export async function removeFavicon(
  supabase: SupabaseClient,
): Promise<DbAppSettings> {
  const { data: existing, error: existingErr } = await supabase
    .from("app_settings")
    .select("favicon_storage_path")
    .eq("id", 1)
    .single();
  if (existingErr) throw existingErr;
  const oldPath =
    (existing as { favicon_storage_path: string | null } | null)
      ?.favicon_storage_path ?? null;

  const updated = await updateAppSettings(supabase, { faviconStoragePath: null });

  if (oldPath) {
    await supabase.storage.from(BRANDING_BUCKET).remove([oldPath]).catch((err) => {
      console.warn("[app-settings] failed to delete old favicon", oldPath, err);
    });
  }

  return updated;
}
