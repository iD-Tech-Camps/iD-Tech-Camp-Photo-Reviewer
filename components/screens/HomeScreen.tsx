"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { SESSION_PHOTOS, PhotoPlaceholder } from "@/components/data";

export function HomeScreen({
  onStart,
  onNav,
  pendingCount = 10,
}: {
  onStart: () => void;
  onNav: (screen: string) => void;
  pendingCount?: number;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Monday · June 9"
        title="Ready when you are, <em>Riley.</em>"
        sub="A fresh batch of 10 photos is waiting. Estimated 4 minutes."
      >
        <button className="btn btn-ghost" onClick={() => onNav("guide")}>
          <Icon name="book" size={14} /> Guide
        </button>
      </PageHeader>

      <div className="page-body" style={{
        display: "grid",
        placeItems: "center",
        minHeight: "calc(100vh - 200px)",
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

          <div className="pennant" style={{ marginBottom: 16 }}>
            <Icon name="bolt" size={11} style={{ marginRight: 6 }} />
            Double-points hour · ends 11:00
          </div>

          <h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: 44, fontWeight: 450, letterSpacing: "-0.02em",
            margin: "0 0 10px",
          }}>
            Start a batch of 10
          </h2>
          <p style={{ color: "var(--ink-3)", fontSize: 15, margin: "0 0 28px", lineHeight: 1.5 }}>
            From Game Dev, Robotics, Film, AI, and Roblox camps.
            Keyboard shortcuts: <span className="kbd">A</span> approve,
            {" "}<span className="kbd">R</span> reject,
            {" "}<span className="kbd">F</span> flag.
          </p>

          <button className="btn btn-primary btn-lg" onClick={onStart}
            style={{ padding: "16px 32px", fontSize: 16 }}>
            <Icon name="play" size={16} /> Start reviewing
          </button>

          <div style={{
            marginTop: 24,
            display: "inline-flex", gap: 20, alignItems: "center",
            fontSize: 12, color: "var(--ink-3)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            <span>{pendingCount} photos</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>~4 min</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <button onClick={() => onNav("leaderboard")}
              style={{ color: "var(--ink-2)", textDecoration: "underline", fontFamily: "inherit", fontSize: "inherit", letterSpacing: "inherit", textTransform: "inherit" }}>
              See your stats
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
