import "server-only";

import {
  brandingAssetUrl,
  fetchAppSettings,
  type DbAppSettings,
} from "@/lib/app-settings";
import { createServiceClient } from "@/lib/supabase/service";

/** Branding shown on unauthenticated surfaces (login, document metadata). */
export type PublicBranding = {
  brandName: string;
  brandTagline: string;
  logoUrl: string | null;
  accent: DbAppSettings["accent"];
};

const FALLBACK: PublicBranding = {
  brandName: "Treeline",
  brandTagline: "Camp Quality Review · iD Tech",
  logoUrl: null,
  accent: "sun",
};

// Reads app_settings via the service role so login/metadata work before
// sign-in (RLS only grants SELECT to authenticated users).
export async function fetchPublicBranding(): Promise<PublicBranding> {
  try {
    const supabase = createServiceClient();
    const row = await fetchAppSettings(supabase);
    if (!row) return FALLBACK;
    return {
      brandName: row.brandName.trim() || FALLBACK.brandName,
      brandTagline: row.brandTagline.trim() || FALLBACK.brandTagline,
      logoUrl: row.faviconStoragePath
        ? brandingAssetUrl(supabase, row.faviconStoragePath)
        : null,
      accent: row.accent,
    };
  } catch {
    return FALLBACK;
  }
}
