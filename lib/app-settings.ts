import type { SupabaseClient } from "@supabase/supabase-js";

// Persisted shape for everything in the AppSettings type that lives on the
// `app_settings` single-row table (see migration 16). Bonus periods stay
// separate — they're a list, modeled by their own table in 7.6d.
//
// Keys mirror the camelCase the SettingsProvider uses; lib/app-settings.ts
// is the single place that maps between snake_case columns and the
// runtime shape.
export type DbAppSettings = {
  brandName: string;
  brandTagline: string;
  brandMark: string;
  homeGreeting: string;
  homeSubtitle: string;
  completionTitle: string;
  completionMessage: string;
  emptyQueueMessage: string;
  supportEmail: string;
  theme: "light" | "dark";
  accent: "sun" | "lake" | "moss" | "rose";
  density: "comfortable" | "compact";
};

type RawAppSettingsRow = {
  brand_name: string | null;
  brand_tagline: string | null;
  brand_mark: string | null;
  home_greeting: string;
  home_subtitle: string;
  completion_title: string;
  completion_message: string;
  empty_queue_message: string;
  support_email: string;
  theme: "light" | "dark";
  accent: "sun" | "lake" | "moss" | "rose";
  density: "comfortable" | "compact";
};

const COLUMNS =
  "brand_name, brand_tagline, brand_mark, " +
  "home_greeting, home_subtitle, " +
  "completion_title, completion_message, empty_queue_message, " +
  "support_email, theme, accent, density";

function mapRow(r: RawAppSettingsRow): DbAppSettings {
  return {
    // brand_* were nullable in migration 7 and remain so. Coerce to "" on
    // read so callers don't have to null-check; admins can blank them in
    // the UI which writes empty string back through.
    brandName:         r.brand_name ?? "",
    brandTagline:      r.brand_tagline ?? "",
    brandMark:         r.brand_mark ?? "",
    homeGreeting:      r.home_greeting,
    homeSubtitle:      r.home_subtitle,
    completionTitle:   r.completion_title,
    completionMessage: r.completion_message,
    emptyQueueMessage: r.empty_queue_message,
    supportEmail:      r.support_email,
    theme:             r.theme,
    accent:            r.accent,
    density:           r.density,
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
// written), so a button that only edits `theme` doesn't roundtrip every
// other column.
function toRowPatch(patch: Partial<DbAppSettings>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.brandName         !== undefined) out.brand_name          = patch.brandName;
  if (patch.brandTagline      !== undefined) out.brand_tagline       = patch.brandTagline;
  if (patch.brandMark         !== undefined) out.brand_mark          = patch.brandMark;
  if (patch.homeGreeting      !== undefined) out.home_greeting       = patch.homeGreeting;
  if (patch.homeSubtitle      !== undefined) out.home_subtitle       = patch.homeSubtitle;
  if (patch.completionTitle   !== undefined) out.completion_title    = patch.completionTitle;
  if (patch.completionMessage !== undefined) out.completion_message  = patch.completionMessage;
  if (patch.emptyQueueMessage !== undefined) out.empty_queue_message = patch.emptyQueueMessage;
  if (patch.supportEmail      !== undefined) out.support_email       = patch.supportEmail;
  if (patch.theme             !== undefined) out.theme               = patch.theme;
  if (patch.accent            !== undefined) out.accent              = patch.accent;
  if (patch.density           !== undefined) out.density             = patch.density;
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
