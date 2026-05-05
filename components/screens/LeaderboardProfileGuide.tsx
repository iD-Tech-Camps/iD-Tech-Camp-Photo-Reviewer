"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { LEADERBOARD, TEAMS, BADGES, EXAMPLES, PhotoPlaceholder } from "@/components/data";

export function LeaderboardScreen() {
  const [scope, setScope] = React.useState("weekly");
  const [view, setView]  = React.useState("individual");

  return (
    <>
      <PageHeader
        eyebrow="You + everyone else"
        title="Stats &amp; <em>Leaderboard.</em>"
        sub="Weekly scores reset Sunday at midnight Pacific."
      >
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--paper-3)", borderRadius: 8 }}>
          {[["individual","Individual"],["team","Team"]].map(([id, label]) => (
            <button key={id}
              onClick={() => setView(id)}
              className="btn"
              style={{
                padding: "6px 12px", fontSize: 12,
                background: view === id ? "var(--paper)" : "transparent",
                boxShadow: view === id ? "var(--shadow-sm)" : "none",
              }}>{label}</button>
          ))}
        </div>
      </PageHeader>

      <div className="page-body">
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
          gap: 14,
          marginBottom: 28,
        }}>
          <div className="card" style={{ background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" }}>
            <div className="card-eyebrow" style={{ color: "color-mix(in oklch, var(--paper) 60%, transparent)" }}>
              Your streak
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 54, fontWeight: 450,
                letterSpacing: "-0.03em", lineHeight: 1,
              }}>9</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>days in a row 🔥</div>
            </div>
            <div style={{ display: "flex", gap: 3, marginTop: 12 }}>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} style={{
                  flex: 1, height: 18, borderRadius: 3,
                  background: i < 9 ? "var(--sun)" : "color-mix(in oklch, var(--paper) 15%, transparent)",
                }} />
              ))}
            </div>
          </div>
          <div className="card">
            <span className="stat-label">Points today</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, letterSpacing: "-0.02em", marginTop: 6 }}>120</div>
          </div>
          <div className="card">
            <span className="stat-label">Your rank</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, letterSpacing: "-0.02em", marginTop: 6 }}>
              #5<small style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)", marginLeft: 6, fontWeight: "normal" }}>of 47</small>
            </div>
          </div>
          <div className="card">
            <span className="stat-label">Week goal</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, letterSpacing: "-0.02em", marginTop: 6 }}>
              14<small style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)", marginLeft: 4, fontWeight: "normal" }}>/ 20</small>
            </div>
            <div className="progress-track" style={{ height: 4, marginTop: 8 }}>
              <div className="progress-fill" style={{ width: "70%", background: "var(--sun)" }} />
            </div>
          </div>
          <div className="card">
            <span className="stat-label">Accuracy</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450, letterSpacing: "-0.02em", marginTop: 6 }}>
              94<small style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)", marginLeft: 2, fontWeight: "normal" }}>%</small>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 20, borderBottom: "1px solid var(--rule)" }}>
          {[["weekly","This week"],["monthly","June"],["all","All time"]].map(([id,label]) => (
            <button key={id}
              onClick={() => setScope(id)}
              style={{
                padding: "10px 0", fontSize: 14,
                color: scope === id ? "var(--ink)" : "var(--ink-3)",
                borderBottom: scope === id ? "2px solid var(--ink)" : "2px solid transparent",
                fontWeight: scope === id ? 600 : 400,
                marginBottom: -1,
              }}>{label}</button>
          ))}
        </div>

        {view === "individual" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, alignItems: "end", marginBottom: 28 }}>
              {[LEADERBOARD[1], LEADERBOARD[0], LEADERBOARD[2]].map((p, i) => {
                const heights = [160, 200, 140];
                const medals = ["🥈", "🥇", "🥉"];
                const colors = ["var(--paper-3)", "var(--sun)", "var(--paper-3)"];
                const txtColor = i === 1 ? "white" : "var(--ink)";
                return (
                  <div key={p.name} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div className="avatar" style={{
                      width: i === 1 ? 64 : 52, height: i === 1 ? 64 : 52,
                      fontSize: i === 1 ? 18 : 15, marginBottom: 10,
                      background: i === 0 ? "var(--lake)" : i === 1 ? "var(--sun)" : "var(--moss)",
                      boxShadow: "var(--shadow-md)",
                    }}>
                      {p.name.split(" ").map(n => n[0]).slice(0,2).join("")}
                    </div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500 }}>
                      {p.name.replace("You — ", "")}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {p.team}
                    </div>
                    <div style={{
                      marginTop: 10,
                      width: "100%", height: heights[i],
                      background: colors[i], color: txtColor,
                      borderRadius: "8px 8px 0 0",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
                      padding: "16px 10px",
                      border: i === 1 ? "none" : "1px solid var(--rule)",
                      borderBottom: "none",
                    }}>
                      <div style={{ fontSize: 32 }}>{medals[i]}</div>
                      <div style={{
                        fontFamily: "var(--font-display)", fontSize: i === 1 ? 34 : 28,
                        fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, marginTop: 4,
                      }}>{p.pts.toLocaleString()}</div>
                      <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", opacity: 0.75, marginTop: 4 }}>PTS</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Rank</th>
                    <th>Reviewer</th>
                    <th>Team</th>
                    <th style={{ width: 90 }}>Streak</th>
                    <th style={{ width: 110 }}>Reviews</th>
                    <th style={{ width: 110, textAlign: "right" }}>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {LEADERBOARD.slice(3).map(p => (
                    <tr key={p.name} style={p.you ? { background: "var(--sun-soft)" } : {}}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600 }}>#{p.rank}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                            {p.name.replace("You — ","").split(" ").map(n => n[0]).slice(0,2).join("")}
                          </div>
                          <span style={{ fontWeight: p.you ? 600 : 500 }}>
                            {p.name}
                            {p.you && <span style={{
                              marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 10,
                              color: "var(--sun)", fontWeight: 600, letterSpacing: "0.06em",
                            }}>YOU</span>}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--ink-2)" }}>{p.team}</td>
                      <td>
                        <span className="pill pill-sun">
                          <Icon name="fire" size={10} /> {p.streak}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>{p.reviews}</td>
                      <td style={{
                        textAlign: "right",
                        fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500,
                      }}>{p.pts.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {TEAMS.map((t, i) => {
              const mine = t.name === "MIT";
              return (
                <div key={t.name} className="card" style={{
                  borderColor: mine ? "var(--sun)" : "var(--rule)",
                  borderWidth: mine ? 2 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                    <span className="card-eyebrow">Rank #{i+1}</span>
                    {mine && <span className="pill pill-sun">Your team</span>}
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>
                    {t.name}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 450,
                    letterSpacing: "-0.03em", marginTop: 8, color: mine ? "var(--sun)" : "var(--ink)",
                  }}>
                    {t.pts.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                    POINTS · {t.members} MEMBERS
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function ProfileScreen() {
  return (
    <>
      <PageHeader
        eyebrow="Your profile"
        title="Riley <em>Turner.</em>"
        sub="Programs · Reviewer · Joined May 28, 2026"
      />

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Career stats</h3>
              <span className="card-eyebrow">Since May 28</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
              <div className="stat">
                <span className="stat-label">Total points</span>
                <span className="stat-value">3,720</span>
              </div>
              <div className="stat">
                <span className="stat-label">Photos reviewed</span>
                <span className="stat-value">372</span>
              </div>
              <div className="stat">
                <span className="stat-label">Best streak</span>
                <span className="stat-value">12<small>days</small></span>
              </div>
              <div className="stat">
                <span className="stat-label">Accuracy</span>
                <span className="stat-value">94<small>%</small></span>
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
