"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { BADGES, EXAMPLES, PhotoPlaceholder } from "@/components/data";

export function ProfileScreen() {
  return (
    <>
      <PageHeader
        eyebrow="Your profile"
        title="Riley <em>Turner.</em>"
        sub="Programs · Staff Reviewer · Joined May 28, 2026"
      />

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Career stats</h3>
              <span className="card-eyebrow">Since May 28</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
              <div className="stat">
                <span className="stat-label">Total points</span>
                <span className="stat-value">3,720</span>
              </div>
              <div className="stat">
                <span className="stat-label">Photos reviewed</span>
                <span className="stat-value">372</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Badges</h3>
              <span className="card-eyebrow">{BADGES.filter(b => b.earned).length} / {BADGES.length} earned</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              {BADGES.map(b => (
                <div key={b.id} style={{
                  padding: 14, borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--rule)",
                  background: b.earned ? "var(--paper)" : "transparent",
                  opacity: b.earned ? 1 : 0.55,
                  textAlign: "center",
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%",
                    background: b.earned ? "var(--sun)" : "var(--paper-3)",
                    color: b.earned ? "white" : "var(--ink-3)",
                    display: "grid", placeItems: "center", margin: "0 auto 8px",
                  }}>
                    <Icon name="medal" size={22} />
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 500 }}>
                    {b.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 4, lineHeight: 1.3 }}>
                    {b.earned
                      ? `EARNED ${b.earnedOn!.toUpperCase()}`
                      : `${b.progress}/${b.total}`}
                  </div>
                  {!b.earned && (b.progress ?? 0) > 0 && (
                    <div className="progress-track" style={{ marginTop: 6, height: 3 }}>
                      <div className="progress-fill" style={{
                        width: (((b.progress ?? 0) / (b.total ?? 1)) * 100) + "%",
                        background: "var(--sun)",
                      }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <div className="card-eyebrow">Current title</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 4 }}>
              Camp Scout
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 14 }}>
              Level 4 · 280 pts to <em>Trailblazer</em>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: "65%", background: "var(--sun)" }} />
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>By camp</h3>
            {([
              ["AI & ML · MIT",    142, "sun"],
              ["Robotics · UCLA",  98,  "lake"],
              ["Game Dev · Stanford", 72, "moss"],
              ["Film · NYU",       40,  "rose"],
              ["Roblox · Caltech", 20,  "ink-2"],
            ] as [string, number, string][]).map(([camp, count, color]) => (
              <div key={camp} style={{
                display: "flex", justifyContent: "space-between",
                padding: "8px 0", borderTop: "1px solid var(--rule)",
                fontSize: 13,
              }}>
                <span style={{ color: "var(--ink-2)" }}>{camp}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: `var(--${color})` }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function GuideScreen() {
  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="The <em>photo guide.</em>"
        sub="Admin-curated examples. Updated June 6 by Harper Rowe."
      />

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card" style={{ gridColumn: "span 2" }}>
          <h3 className="card-title" style={{ marginBottom: 12 }}>The 30-second rubric</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {[
              ["01", "Can you see a face?", "At least one subject's face should be visible and in focus."],
              ["02", "Does it feel safe?",   "Nothing you'd be uncomfortable sending to a parent."],
              ["03", "Is the camp readable?","Backdrop should suggest what the kids are doing."],
            ].map(([n, q, a]) => (
              <div key={n} className="accent-bar">
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 10,
                  color: "var(--ink-3)", letterSpacing: "0.1em",
                }}>STEP {n}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 500, margin: "4px 0 6px", letterSpacing: "-0.01em" }}>
                  {q}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4 }}>{a}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <span className="card-eyebrow" style={{ color: "var(--moss)" }}>Approve these</span>
              <h3 className="card-title">Good photos</h3>
            </div>
            <span className="pill pill-moss">
              <Icon name="check" size={10} /> {EXAMPLES.good.length} examples
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {EXAMPLES.good.map(ex => (
              <div key={ex.id}>
                <div style={{
                  aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                  position: "relative", border: "2px solid var(--moss)", marginBottom: 8,
                }}>
                  <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500 }}>
                  {ex.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  {ex.note}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <span className="card-eyebrow" style={{ color: "var(--sun)" }}>Flag these</span>
              <h3 className="card-title">Problem photos</h3>
            </div>
            <span className="pill pill-sun">
              <Icon name="flag" size={10} /> {EXAMPLES.bad.length} examples
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {EXAMPLES.bad.map((ex, i) => (
              <div key={ex.id}>
                <div style={{
                  aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                  position: "relative", border: "2px solid var(--sun)", marginBottom: 8,
                  filter: i === 0 ? "blur(2px)" : "none",
                }}>
                  <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500 }}>
                  {ex.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  {ex.note}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}
