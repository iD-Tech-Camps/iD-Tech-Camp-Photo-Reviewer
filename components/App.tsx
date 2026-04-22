"use client";

import React from "react";
import { Sidebar, fireConfetti, useToast } from "@/components/Shell";
import { HomeScreen } from "@/components/screens/HomeScreen";
import { ReviewScreen, SessionComplete } from "@/components/screens/ReviewScreen";
import {
  LeaderboardScreen,
  ProfileScreen,
  GuideScreen,
} from "@/components/screens/LeaderboardProfileGuide";
import {
  AdminOverview,
  AdminAssignment,
  AdminPoints,
  AdminExamples,
  AdminUsers,
  AdminSettings,
} from "@/components/screens/Admin";
import { SettingsProvider, useSettings } from "@/components/settings";
import { UserProvider } from "@/lib/current-user";

const VALID_SCREENS = [
  "review",
  "leaderboard",
  "profile",
  "guide",
  "admin-overview",
  "admin-assignment",
  "admin-points",
  "admin-examples",
  "admin-users",
  "admin-settings",
];

export default function App() {
  return (
    <UserProvider>
      <SettingsProvider>
        <AppInner />
      </SettingsProvider>
    </UserProvider>
  );
}

function AppInner() {
  const { settings } = useSettings();
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
    if (settings.confettiOnComplete) {
      setTimeout(() => fireConfetti(window.innerWidth * 0.2, window.innerHeight * 0.4, 60), 200);
      setTimeout(() => fireConfetti(window.innerWidth * 0.8, window.innerHeight * 0.4, 60), 400);
    }
  };

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

  return (
    <div className="app-shell" data-screen-label={screen}>
      <Sidebar
        current={screen}
        onNav={setScreen}
        isAdmin={true}
      />
      <main className="main">
        {screen === "review"      && <HomeScreen onStart={handleStart} onNav={setScreen} />}
        {screen === "leaderboard" && <LeaderboardScreen />}
        {screen === "profile"     && <ProfileScreen />}
        {screen === "guide"       && <GuideScreen />}
        {screen === "admin-overview"   && <AdminOverview />}
        {screen === "admin-assignment" && <AdminAssignment />}
        {screen === "admin-points"     && <AdminPoints />}
        {screen === "admin-examples"   && <AdminExamples />}
        {screen === "admin-users"      && <AdminUsers />}
        {screen === "admin-settings"   && <AdminSettings />}
      </main>
      {toast.node}
    </div>
  );
}
