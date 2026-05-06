"use client";

import React from "react";
import { Sidebar, fireConfetti, useToast } from "@/components/Shell";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { ReviewScreen, SessionComplete } from "@/components/screens/ReviewScreen";
import {
  ProfileScreen,
  GuideScreen,
} from "@/components/screens/LeaderboardProfileGuide";
import {
  AdminOverview,
  AdminAssignment,
  AdminPoints,
  AdminExamples,
  AdminSettings,
} from "@/components/screens/Admin";
import { FlagReviewScreen } from "@/components/screens/FlagReview";
import { BonusPeriodsProvider, SettingsProvider, useSettings } from "@/components/settings";
import { UserProvider, useCurrentUser, type Role } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import { fetchPendingCount } from "@/lib/reviews";

const VALID_SCREENS = [
  "review",
  "profile",
  "guide",
  "flag-review",
  "admin-overview",
  "admin-assignment",
  "admin-points",
  "admin-examples",
  "admin-settings",
];

const SENIOR_SCREENS = new Set(["flag-review"]);
const ADMIN_SCREENS = new Set([
  "admin-overview",
  "admin-assignment",
  "admin-points",
  "admin-examples",
  "admin-settings",
]);

function screenAllowedFor(screen: string, role: Role): boolean {
  if (ADMIN_SCREENS.has(screen)) return role === "admin";
  if (SENIOR_SCREENS.has(screen)) return role === "senior" || role === "admin";
  return true;
}

export default function App() {
  return (
    <UserProvider>
      <SettingsProvider>
        <BonusPeriodsProvider>
          <AppInner />
        </BonusPeriodsProvider>
      </SettingsProvider>
    </UserProvider>
  );
}

function AppInner() {
  const { settings } = useSettings();
  const { role } = useCurrentUser();
  const [screen, setScreen] = React.useState<string>("review");
  const [mode, setMode] = React.useState<"nav" | "session" | "complete">("nav");
  const [sessionResult, setSessionResult] = React.useState<Record<string, any> | null>(null);
  const [showExamplesDrawer, setShowExamplesDrawer] = React.useState(true);
  const toast = useToast();

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("screen");
    if (saved && VALID_SCREENS.includes(saved)) setScreen(saved);
  }, []);

  React.useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("screen", screen);
  }, [screen]);

  React.useEffect(() => {
    if (!screenAllowedFor(screen, role)) {
      setScreen("review");
    }
  }, [screen, role]);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
    const accentMap: Record<string, string> = {
      sun: "oklch(0.72 0.17 55)",
      lake: "oklch(0.58 0.11 230)",
      moss: "oklch(0.55 0.12 155)",
      rose: "oklch(0.62 0.16 25)",
    };
    document.documentElement.style.setProperty("--sun", accentMap[settings.accent] || accentMap.sun);
  }, [settings.theme, settings.accent]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const name = settings.brandName.trim();
    const tag = settings.brandTagline.trim();
    document.title = name && tag ? `${name} · ${tag}` : name || tag || "Photo Review";
  }, [settings.brandName, settings.brandTagline]);

  const handleStart = () => setMode("session");
  const handleExit  = () => setMode("nav");
  const handleComplete = (decisions: Record<string, any>) => {
    setSessionResult(decisions);
    setMode("complete");
    setTimeout(() => fireConfetti(window.innerWidth * 0.2, window.innerHeight * 0.4, 60), 200);
    setTimeout(() => fireConfetti(window.innerWidth * 0.8, window.innerHeight * 0.4, 60), 400);
  };

  // Live count of `pending` photos for the sidebar Review badge and the
  // HomeScreen subtitle template ({{count}}). Refetches when the session
  // ends so the badge reflects the work just completed. Null while the
  // first request is in flight; consumers fall back to a placeholder.
  const [pendingCount, setPendingCount] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (mode !== "nav") return;
    let cancelled = false;
    const supabase = createClient();
    fetchPendingCount(supabase)
      .then((n) => { if (!cancelled) setPendingCount(n); })
      .catch((err) => {
        console.warn("[app] pending count fetch failed:", err?.message ?? err);
      });
    return () => { cancelled = true; };
  }, [mode]);

  if (mode === "session") {
    return (
      <>
        <ReviewScreen
          onComplete={handleComplete}
          onExit={handleExit}
          showExamplesDrawer={showExamplesDrawer}
          setShowExamplesDrawer={setShowExamplesDrawer}
          toast={toast}
        />
        {toast.node}
      </>
    );
  }

  if (mode === "complete") {
    return (
      <>
        <SessionComplete
          decisions={sessionResult ?? {}}
          onHome={() => { setMode("nav"); setScreen("review"); }}
          onAnother={() => setMode("session")}
        />
        {toast.node}
      </>
    );
  }

  const activeScreen = screenAllowedFor(screen, role) ? screen : "review";

  return (
    <div className="app-shell" data-screen-label={activeScreen}>
      <Sidebar
        current={activeScreen}
        onNav={setScreen}
        pendingCount={pendingCount ?? undefined}
      />
      <main className="main">
        {activeScreen === "review"      && <HomeScreen onStart={handleStart} onNav={setScreen} pendingCount={pendingCount ?? undefined} />}
        {activeScreen === "profile"     && <ProfileScreen />}
        {activeScreen === "guide"       && <GuideScreen />}
        {activeScreen === "flag-review" && <FlagReviewScreen toast={toast} />}
        {activeScreen === "admin-overview"   && <AdminOverview />}
        {activeScreen === "admin-assignment" && <AdminAssignment />}
        {activeScreen === "admin-points"     && <AdminPoints />}
        {activeScreen === "admin-examples"   && <AdminExamples />}
        {activeScreen === "admin-settings"   && <AdminSettings />}
      </main>
      {toast.node}
    </div>
  );
}
