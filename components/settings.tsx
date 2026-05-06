"use client";

import React from "react";

export type BonusPeriodMode = "recurring" | "one-time";

// Persisted shape for an admin-configured "double points" (or any multiplier)
// window. `mode = recurring` uses `days[]` + `startTime`/`endTime` (HH:MM,
// local browser timezone). `mode = one-time` uses `startAt`/`endAt` as
// `datetime-local` strings (no zone — interpreted in the reviewer's local tz).
export type BonusPeriod = {
  id: string;
  label: string;
  mode: BonusPeriodMode;
  days: number[];
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  multiplier: number;
  enabled: boolean;
};

export type AppSettings = {
  brandName: string;
  brandTagline: string;
  brandMark: string;

  homeGreeting: string;
  homeSubtitle: string;

  completionTitle: string;
  completionMessage: string;
  emptyQueueMessage: string;

  theme: "light" | "dark";
  accent: "sun" | "lake" | "moss" | "rose";
  density: "comfortable" | "compact";

  supportEmail: string;

  bonusPeriods: BonusPeriod[];
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

  theme: "light",
  accent: "sun",
  density: "comfortable",

  supportEmail: "support@idtech.com",

  // One sample period seeded so the admin UI isn't empty out of the box.
  // Disabled by default so reviewers don't see a pennant until an admin opts in.
  bonusPeriods: [
    {
      id: "bp_default_double",
      label: "Double-points hour",
      mode: "recurring",
      days: [0, 1, 2, 3, 4, 5, 6],
      startTime: "10:00",
      endTime: "11:00",
      startAt: "",
      endAt: "",
      multiplier: 2,
      enabled: false,
    },
  ],
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

const STORAGE_KEY = "app-settings-v1";

type Ctx = {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
};

const SettingsContext = React.createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch {}
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  }, [settings, hydrated]);

  const update = React.useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const reset = React.useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) {
    return { settings: DEFAULT_SETTINGS, update: () => {}, reset: () => {} };
  }
  return ctx;
}

export function fillTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
