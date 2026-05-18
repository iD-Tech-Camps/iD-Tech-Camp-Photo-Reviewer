"use client";

import React from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAppSettings,
  updateAppSettings,
  uploadFavicon as dbUploadFavicon,
  removeFavicon as dbRemoveFavicon,
  type DbAppSettings,
} from "@/lib/app-settings";

// Branding shape the app needs at runtime. Migration 26 dropped the five
// reviewer-copy fields (home_greeting, home_subtitle, completion_*,
// empty_queue_message) and the bonus_periods table — both belonged to
// the marketing-review surface. Any triage-flow copy keys land here
// when they're introduced.
export type AppSettings = {
  brandName: string;
  brandTagline: string;
  brandMark: string;

  // Brand color. Theme is per-user (see profiles.theme + useCurrentUser);
  // density was dropped in step 7.7c (never wired to the DOM/CSS).
  accent: "sun" | "lake" | "moss" | "rose";

  supportEmail: string;

  // Storage path of the admin-uploaded favicon. NULL = no favicon
  // configured. Mutated through setFavicon (not the regular update path).
  faviconStoragePath: string | null;
};

export const DEFAULT_SETTINGS: AppSettings = {
  brandName: "Treeline",
  brandTagline: "Camp Quality Review · iD Tech",
  brandMark: "Ƭ",

  accent: "sun",

  supportEmail: "support@idtech.com",

  faviconStoragePath: null,
};

// ── App settings (single-row) ───────────────────────────────────────────────

type Ctx = {
  settings: AppSettings;
  // hydrated = false during initial DB fetch. UI can show skeletons or
  // just render with DEFAULT_SETTINGS until the real values land.
  hydrated: boolean;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  reset: () => Promise<void>;
  // Upload (or remove) the admin-uploaded favicon. Pass `null` to remove.
  // Routed through a dedicated method because favicon mutations touch
  // both `app_settings.favicon_storage_path` and the storage bucket, and
  // need to be excluded from `reset()` so a "reset copy" click doesn't
  // wipe a separately-managed brand asset.
  setFavicon: (file: File | null) => Promise<void>;
  // Surfaced so admins see when a write to the DB fails (e.g. they lost
  // their admin role mid-session and the RLS policy now rejects writes).
  saveError: string | null;
};

const SettingsContext = React.createContext<Ctx | null>(null);

// Subset of AppSettings keys that map 1:1 to the `app_settings` row and
// flow through the standard `update()` path. Keeping the list explicit
// means a future "in-memory only" settings key (e.g. a per-tab debug
// flag) can be added without accidentally writing to the DB.
//
// `faviconStoragePath` is intentionally NOT in this list — it's mutated
// through `setFavicon()` so the favicon's lifecycle (storage upload +
// old-file cleanup) stays separate from text-field saves and so the
// reset-to-defaults button doesn't wipe the uploaded asset.
const DB_BACKED_KEYS = [
  "brandName",
  "brandTagline",
  "brandMark",
  "supportEmail",
  "accent",
] as const satisfies readonly (keyof DbAppSettings)[];

function pickDbPatch(patch: Partial<AppSettings>): Partial<DbAppSettings> {
  const out: Partial<DbAppSettings> = {};
  for (const key of DB_BACKED_KEYS) {
    if (key in patch) {
      (out as Record<string, unknown>)[key] = patch[key as keyof AppSettings];
    }
  }
  return out;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const supabase = React.useMemo(() => createClient(), []);

  // Pull the DB-backed slice once on mount. Failure → log and keep the
  // defaults so the app still renders rather than getting stuck on a
  // skeleton. Concretely, this means the first session after a DB outage
  // shows the seeded defaults rather than an empty page.
  React.useEffect(() => {
    let cancelled = false;
    fetchAppSettings(supabase)
      .then((row) => {
        if (cancelled) return;
        if (row) setSettings((prev) => ({ ...prev, ...row }));
        setHydrated(true);
      })
      .catch((err) => {
        console.warn("[settings] fetch failed:", err?.message ?? err);
        if (!cancelled) setHydrated(true);
      });
    return () => { cancelled = true; };
  }, [supabase]);

  const update = React.useCallback(
    async (patch: Partial<AppSettings>) => {
      // Apply optimistically so the UI updates immediately. Roll back on
      // DB failure so admins see what actually persisted.
      const previous = settings;
      setSettings((prev) => ({ ...prev, ...patch }));
      setSaveError(null);

      const dbPatch = pickDbPatch(patch);
      if (Object.keys(dbPatch).length === 0) return;

      try {
        const updated = await updateAppSettings(supabase, dbPatch);
        // Replace with the canonical row in case the DB normalized any
        // values (whitespace, casing, etc.).
        setSettings((prev) => ({ ...prev, ...updated }));
      } catch (err: any) {
        console.error("[settings] update failed:", err);
        setSaveError(err?.message ?? "Couldn't save settings.");
        setSettings(previous);
      }
    },
    [settings, supabase],
  );

  const reset = React.useCallback(async () => {
    setSaveError(null);
    const previous = settings;
    // Preserve the uploaded favicon across "reset copy"; only the
    // text/appearance fields revert. Removing the favicon is a separate
    // explicit action under its own button.
    setSettings({ ...DEFAULT_SETTINGS, faviconStoragePath: settings.faviconStoragePath });
    try {
      const updated = await updateAppSettings(supabase, pickDbPatch(DEFAULT_SETTINGS));
      setSettings((prev) => ({ ...prev, ...updated }));
    } catch (err: any) {
      console.error("[settings] reset failed:", err);
      setSaveError(err?.message ?? "Couldn't reset settings.");
      setSettings(previous);
    }
  }, [settings, supabase]);

  const setFavicon = React.useCallback(
    async (file: File | null) => {
      setSaveError(null);
      const previous = settings;
      // Optimistic flip on the path so the UI feels immediate. The
      // canonical row from the DB lands afterwards and overwrites this.
      setSettings((prev) => ({
        ...prev,
        faviconStoragePath: file ? prev.faviconStoragePath : null,
      }));
      try {
        const updated = file
          ? await dbUploadFavicon(supabase, file)
          : await dbRemoveFavicon(supabase);
        setSettings((prev) => ({ ...prev, ...updated }));
      } catch (err: any) {
        console.error("[settings] favicon update failed:", err);
        setSaveError(err?.message ?? "Couldn't update favicon.");
        setSettings(previous);
      }
    },
    [settings, supabase],
  );

  return (
    <SettingsContext.Provider value={{ settings, hydrated, update, reset, setFavicon, saveError }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) {
    return {
      settings: DEFAULT_SETTINGS,
      hydrated: false,
      update: async () => {},
      reset: async () => {},
      setFavicon: async () => {},
      saveError: null,
    };
  }
  return ctx;
}
