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
import {
  fetchBonusPeriods,
  createBonusPeriod as dbCreateBonusPeriod,
  updateBonusPeriod as dbUpdateBonusPeriod,
  deleteBonusPeriod as dbDeleteBonusPeriod,
  setBonusPeriodEnabled as dbSetBonusPeriodEnabled,
  type BonusPeriod,
  type BonusPeriodMode,
} from "@/lib/bonus-periods";

// Re-export so existing imports (`@/components/settings`) keep resolving.
// The canonical source of these types is now `lib/bonus-periods.ts`.
export type { BonusPeriod, BonusPeriodMode };

export type AppSettings = {
  brandName: string;
  brandTagline: string;
  brandMark: string;

  homeGreeting: string;
  homeSubtitle: string;

  completionTitle: string;
  completionMessage: string;
  emptyQueueMessage: string;

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
  brandTagline: "Photo Review · iD Tech",
  brandMark: "Ƭ",

  homeGreeting: "Ready when you are, {name}.",
  homeSubtitle: "A fresh batch of {count} photos is waiting.",

  completionTitle: "Batch complete.",
  completionMessage: "Nice work. The next batch will be ready shortly.",
  emptyQueueMessage: "No photos waiting right now. Check back soon.",

  accent: "sun",

  supportEmail: "support@idtech.com",

  faviconStoragePath: null,
};

// Returns the highest-multiplier BonusPeriod that is currently active,
// or null if none. "Active" means: enabled, and `now` falls within either
// the recurring weekly window or the one-time datetime range.
//
// All timestamps are interpreted in the reviewer's local browser timezone —
// the admin schedules in their tz and reviewers see the pennant in theirs.
// That's the simplest model and matches how the admin UI presents times.
export function activeBonusPeriod(
  periods: BonusPeriod[] | undefined | null,
  now: Date = new Date(),
): BonusPeriod | null {
  if (!periods || periods.length === 0) return null;
  let best: BonusPeriod | null = null;
  for (const p of periods) {
    if (!p.enabled) continue;
    if (!isBonusPeriodActiveAt(p, now)) continue;
    if (!best || p.multiplier > best.multiplier) best = p;
  }
  return best;
}

function isBonusPeriodActiveAt(p: BonusPeriod, now: Date): boolean {
  if (p.mode === "recurring") {
    if (!p.days.includes(now.getDay())) return false;
    const start = parseHHMM(p.startTime);
    const end = parseHHMM(p.endTime);
    if (start === null || end === null || end <= start) return false;
    const minutes = now.getHours() * 60 + now.getMinutes();
    return minutes >= start && minutes < end;
  }
  if (!p.startAt || !p.endAt) return false;
  const s = new Date(p.startAt).getTime();
  const e = new Date(p.endAt).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return false;
  const t = now.getTime();
  return t >= s && t < e;
}

function parseHHMM(hhmm: string): number | null {
  const parts = hhmm.split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Formats a `BonusPeriod`'s active window in a way reviewers can read at a
// glance. The pennant on HomeScreen and ReviewScreen calls this so the
// reviewer knows when the bonus runs (and crucially, when it ends so they
// can decide whether to bank reviews now).
//
// Recurring → "10:00 AM – 11:00 AM" (start–end)
// One-time, same calendar day → "Jun 5, 10:00 AM – 5:00 PM"
// One-time, multi-day → "Jun 5, 10:00 AM – Jun 6, 5:00 PM"
//
// Both timestamps are rendered in the reviewer's local timezone, matching
// how the admin scheduled them.
export function formatBonusWindow(p: BonusPeriod): string {
  if (p.mode === "recurring") {
    return `${formatTime12(p.startTime)} – ${formatTime12(p.endTime)}`;
  }
  if (!p.startAt || !p.endAt) return "";
  const s = new Date(p.startAt);
  const e = new Date(p.endAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const dateFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateFmt)}, ${s.toLocaleTimeString(undefined, timeFmt)} – ${e.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${s.toLocaleDateString(undefined, dateFmt)}, ${s.toLocaleTimeString(undefined, timeFmt)} – ${e.toLocaleDateString(undefined, dateFmt)}, ${e.toLocaleTimeString(undefined, timeFmt)}`;
}

// Pretty multiplier: 2× / 1.5× rather than 2.0× / 1.5×.
export function formatBonusMultiplier(multiplier: number): string {
  return multiplier % 1 === 0 ? `${multiplier}×` : `${multiplier.toFixed(1)}×`;
}

function formatTime12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return hhmm;
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m} ${period}`;
}

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
  "homeGreeting",
  "homeSubtitle",
  "completionTitle",
  "completionMessage",
  "emptyQueueMessage",
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

// ── Bonus periods (multi-row) ───────────────────────────────────────────────
// Step 7.6d split the schedule out of AppSettings into its own DB table
// (`bonus_periods`, migration 17). It needed its own provider because the
// shape is a list rather than a singleton object, and CRUD is row-based.
//
// Consumers:
//   - Shell.tsx → useActiveBonusPeriod uses the `periods` slice
//   - HomeScreen / ReviewScreen render a pennant when an active period exists
//   - Admin → Points & rules → Points multiplier bonus reads + writes here

type BonusPeriodsCtx = {
  periods: BonusPeriod[];
  hydrated: boolean;
  saveError: string | null;
  create: (period: Omit<BonusPeriod, "id">) => Promise<void>;
  update: (id: string, period: Partial<BonusPeriod> & { mode: BonusPeriodMode }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
};

const BonusPeriodsContext = React.createContext<BonusPeriodsCtx | null>(null);

export function BonusPeriodsProvider({ children }: { children: React.ReactNode }) {
  const [periods, setPeriods] = React.useState<BonusPeriod[]>([]);
  const [hydrated, setHydrated] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    let cancelled = false;
    fetchBonusPeriods(supabase)
      .then((rows) => {
        if (cancelled) return;
        setPeriods(rows);
        setHydrated(true);
      })
      .catch((err) => {
        console.warn("[bonus-periods] fetch failed:", err?.message ?? err);
        if (!cancelled) setHydrated(true);
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // Each mutation does the optimistic update locally and reconciles with
  // the DB result. On error we surface it via `saveError` and roll the
  // local list back to the pre-write snapshot.

  const create = React.useCallback(async (period: Omit<BonusPeriod, "id">) => {
    setSaveError(null);
    const previous = periods;
    // Temporary id placeholder for the optimistic insertion.
    const placeholder: BonusPeriod = { ...period, id: `temp_${Date.now()}` };
    setPeriods([...previous, placeholder]);
    try {
      const created = await dbCreateBonusPeriod(supabase, period);
      setPeriods((prev) => prev.map((p) => (p.id === placeholder.id ? created : p)));
    } catch (err: any) {
      console.error("[bonus-periods] create failed:", err);
      setSaveError(err?.message ?? "Couldn't save bonus period.");
      setPeriods(previous);
    }
  }, [periods, supabase]);

  const update = React.useCallback(
    async (id: string, period: Partial<BonusPeriod> & { mode: BonusPeriodMode }) => {
      setSaveError(null);
      const previous = periods;
      setPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...period } : p)));
      try {
        const updated = await dbUpdateBonusPeriod(supabase, id, period);
        setPeriods((prev) => prev.map((p) => (p.id === id ? updated : p)));
      } catch (err: any) {
        console.error("[bonus-periods] update failed:", err);
        setSaveError(err?.message ?? "Couldn't save bonus period.");
        setPeriods(previous);
      }
    },
    [periods, supabase],
  );

  const remove = React.useCallback(async (id: string) => {
    setSaveError(null);
    const previous = periods;
    setPeriods((prev) => prev.filter((p) => p.id !== id));
    try {
      await dbDeleteBonusPeriod(supabase, id);
    } catch (err: any) {
      console.error("[bonus-periods] delete failed:", err);
      setSaveError(err?.message ?? "Couldn't remove bonus period.");
      setPeriods(previous);
    }
  }, [periods, supabase]);

  const toggle = React.useCallback(async (id: string, enabled: boolean) => {
    setSaveError(null);
    const previous = periods;
    setPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
    try {
      await dbSetBonusPeriodEnabled(supabase, id, enabled);
    } catch (err: any) {
      console.error("[bonus-periods] toggle failed:", err);
      setSaveError(err?.message ?? "Couldn't update bonus period.");
      setPeriods(previous);
    }
  }, [periods, supabase]);

  return (
    <BonusPeriodsContext.Provider value={{ periods, hydrated, saveError, create, update, remove, toggle }}>
      {children}
    </BonusPeriodsContext.Provider>
  );
}

export function useBonusPeriods(): BonusPeriodsCtx {
  const ctx = React.useContext(BonusPeriodsContext);
  if (!ctx) {
    return {
      periods: [],
      hydrated: false,
      saveError: null,
      create: async () => {},
      update: async () => {},
      remove: async () => {},
      toggle: async () => {},
    };
  }
  return ctx;
}

// ── Templating ──────────────────────────────────────────────────────────────

export function fillTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
