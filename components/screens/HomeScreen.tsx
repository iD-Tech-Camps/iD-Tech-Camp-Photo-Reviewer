"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { SESSION_PHOTOS, PhotoPlaceholder } from "@/components/data";
import { useSettings, fillTemplate } from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";

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
            {SESSION_PHOTOS.slice(0, 10).map(p => (
              <div key={p.id} style={{
                aspectRatio: "3/2",
                borderRadius: 6,
                overflow: "hidden",
                position: "relative",
                background: "var(--paper-3)",
                boxShadow: "var(--shadow-sm)",
              }}>
                <PhotoPlaceholder photo={p} compact hideLabel />
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
            style={{ padding: "16px 32px", fontSize: 16, marginBottom: 32 }}>
            <Icon name="play" size={16} /> Start reviewing
          </button>
        </div>
      </div>
    </>
  );
}
