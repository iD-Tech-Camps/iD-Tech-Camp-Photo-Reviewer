"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { BonusPennant, PageHeader, useActiveBonusPeriod } from "@/components/Shell";
import { PhotoPlaceholder } from "@/components/data";
import { useSettings, fillTemplate } from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";

// Decorative thumbnail strip on the home screen — purely visual stand-ins
// until real SmugMug thumbnails land in step 8. The ids are picked so each
// one hashes to a different palette in PhotoPlaceholder; the labels are
// hidden anyway (hideLabel).
const HERO_THUMB_IDS = ["p0","p1","p2","p3","p4","p5","p6","p7","p8","p9"];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function greetingHtml(template: string, name: string): string {
  return fillTemplate(escapeHtml(template), { name: escapeHtml(name) });
}

export function HomeScreen({
  onStart,
  onNav,
  pendingCount,
}: {
  onStart: () => void;
  onNav: (screen: string) => void;
  pendingCount?: number;
}) {
  const { settings } = useSettings();
  const { firstName } = useCurrentUser();
  const activePeriod = useActiveBonusPeriod();
  const reviewerName = firstName || "there";
  const greeting = greetingHtml(settings.homeGreeting, reviewerName);
  const subtitle = fillTemplate(settings.homeSubtitle, {
    name: reviewerName,
    count: pendingCount ?? "—",
  });

  return (
    <>
      <PageHeader
        eyebrow="Monday · June 9"
        title={greeting}
        sub={subtitle}
      >
        <button className="btn btn-ghost" onClick={() => onNav("guide")}>
          <Icon name="book" size={14} /> Guide
        </button>
      </PageHeader>

      <div className="page-body" style={{
        display: "grid",
        placeItems: "center",
        minHeight: "calc(100vh - 200px)",
        paddingBottom: 0,
      }}>
        <div style={{ maxWidth: 640, width: "100%", textAlign: "center" }}>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8,
            marginBottom: 28,
          }}>
            {HERO_THUMB_IDS.map(id => (
              <div key={id} style={{
                aspectRatio: "3/2",
                borderRadius: 6,
                overflow: "hidden",
                position: "relative",
                background: "var(--paper-3)",
                boxShadow: "var(--shadow-sm)",
              }}>
                <PhotoPlaceholder photo={{ id }} compact hideLabel />
              </div>
            ))}
          </div>

          <h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: 44, fontWeight: 450, letterSpacing: "-0.02em",
            margin: "0 0 10px",
          }}>
            Start a batch of 10
          </h2>
          <p style={{
            color: "var(--ink-2)",
            fontSize: 14,
            margin: "0 0 28px",
            lineHeight: 1.5,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="kbd">A</span> approve
            </span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="kbd">F</span> flag
            </span>
          </p>

          <button className="btn btn-primary btn-lg" onClick={onStart}
            style={{ padding: "16px 32px", fontSize: 16, marginBottom: activePeriod ? 18 : 32 }}>
            <Icon name="play" size={16} /> Start reviewing
          </button>

          {activePeriod && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
              <BonusPennant period={activePeriod} variant="banner" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
