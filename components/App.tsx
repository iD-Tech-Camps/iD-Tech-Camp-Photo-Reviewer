"use client";

import React from "react";
import { Sidebar, useToast } from "@/components/Shell";
import {
  AdminOverview,
  AdminTags,
  AdminSettings,
  SmugMugImport,
} from "@/components/screens/Admin";
import { AdminLocationsNotes } from "@/components/screens/AdminLocations";
import { TriageApp } from "@/components/screens/Triage";
import { PhotoRatingApp } from "@/components/screens/PhotoRating";
import { SeniorReviewApp } from "@/components/screens/SeniorReview";
import { MyStatsApp } from "@/components/screens/MyStats";
import { SettingsProvider, useSettings } from "@/components/settings";
import { UserProvider, useCurrentUser, type Role } from "@/lib/current-user";
import { PointsProvider } from "@/lib/points-context";

import {
  readPersistedScreen,
  syncScreenToUrl,
} from "@/lib/app-route";

const VALID_SCREENS = [
  "triage",
  "photo-rating",
  "my-stats",
  "senior-review",
  "admin-overview",
  "admin-locations",
  "admin-tags",
  "admin-smugmug",
  "admin-settings",
];

const ADMIN_SCREENS = new Set([
  "admin-overview",
  "admin-locations",
  "admin-tags",
  "admin-smugmug",
  "admin-settings",
]);

const SENIOR_ONLY_SCREENS = new Set(["senior-review"]);

function screenAllowedFor(screen: string, role: Role): boolean {
  if (ADMIN_SCREENS.has(screen)) return role === "admin";
  if (SENIOR_ONLY_SCREENS.has(screen)) return role === "senior" || role === "admin";
  return true;
}

export default function App() {
  return (
    <UserProvider>
      <SettingsProvider>
        <PointsProvider>
          <AppInner />
        </PointsProvider>
      </SettingsProvider>
    </UserProvider>
  );
}

function AppInner() {
  const { settings } = useSettings();
  const { role, theme, loading: userLoading } = useCurrentUser();
  const [screen, setScreenState] = React.useState<string | null>(null);
  const toast = useToast();

  React.useEffect(() => {
    setScreenState(readPersistedScreen(VALID_SCREENS));
  }, []);

  const setScreen = React.useCallback((next: string) => {
    setScreenState(next);
    localStorage.setItem("screen", next);
    syncScreenToUrl(next);
  }, []);

  React.useEffect(() => {
    if (screen === null || userLoading) return;
    if (!screenAllowedFor(screen, role)) {
      setScreen("triage");
    }
  }, [screen, role, userLoading, setScreen]);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  React.useEffect(() => {
    const accentMap: Record<string, string> = {
      sun: "oklch(0.72 0.17 55)",
      lake: "oklch(0.58 0.11 230)",
      moss: "oklch(0.55 0.12 155)",
      rose: "oklch(0.62 0.16 25)",
    };
    document.documentElement.style.setProperty("--sun", accentMap[settings.accent] || accentMap.sun);
  }, [settings.accent]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const name = settings.brandName.trim();
    const tag = settings.brandTagline.trim();
    document.title = name && tag ? `${name} · ${tag}` : name || tag || "iD Tech Camp Quality Review";
  }, [settings.brandName, settings.brandTagline]);

  const activeScreen =
    screen === null
      ? null
      : userLoading || screenAllowedFor(screen, role)
        ? screen
        : "triage";

  if (activeScreen === null) {
    return (
      <div className="app-shell" data-screen-label="loading">
        <Sidebar current="triage" onNav={setScreen} />
        <main className="main" />
        {toast.node}
      </div>
    );
  }

  return (
    <div className="app-shell" data-screen-label={activeScreen}>
      <Sidebar current={activeScreen} onNav={setScreen} />
      <main className="main">
        {activeScreen === "triage"           && <TriageApp toast={toast} />}
        {activeScreen === "photo-rating"     && <PhotoRatingApp toast={toast} />}
        {activeScreen === "my-stats"         && <MyStatsApp />}
        {activeScreen === "senior-review"   && <SeniorReviewApp toast={toast} />}
        {activeScreen === "admin-overview"  && <AdminOverview toast={toast} />}
        {activeScreen === "admin-locations" && <AdminLocationsNotes toast={toast} />}
        {activeScreen === "admin-tags"      && <AdminTags />}
        {activeScreen === "admin-smugmug"   && <SmugMugImport toast={toast} />}
        {activeScreen === "admin-settings"  && <AdminSettings />}
      </main>
      {toast.node}
    </div>
  );
}
