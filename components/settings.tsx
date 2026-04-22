"use client";

import React from "react";

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

  confettiOnComplete: boolean;
  showLeaderboard: boolean;
  showStreaks: boolean;
  showDoublePoints: boolean;

  supportEmail: string;
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

  confettiOnComplete: true,
  showLeaderboard: true,
  showStreaks: true,
  showDoublePoints: true,

  supportEmail: "support@idtech.com",
};

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
