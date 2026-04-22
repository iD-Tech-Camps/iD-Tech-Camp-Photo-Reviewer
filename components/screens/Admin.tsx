"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/Shell";
import { EXAMPLES, ADMIN_USERS, PhotoPlaceholder } from "@/components/data";
import { useSettings, AppSettings } from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";

export function AdminOverview() {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="<em>Overview.</em>"
        sub="The whole operation at a glance."
      >
        <button className="btn btn-ghost"><Icon name="download" size={14} /> Export CSV</button>
        <button className="btn btn-primary"><Icon name="bolt" size={14} /> Start double-points</button>
      </PageHeader>

      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 20 }}>
          {([
            ["In queue",       "2,481", "photos"],
            ["Reviewed today", "1,204", "photos"],
            ["Avg time/photo", "22",    "sec"],
            ["Flag rate",      "4.7",   "%"],
            ["Active reviewers","31",   "/ 47"],
          ] as [string, string, string][]).map(([l, v, u]) => (
            <div key={l} className="card">
              <span className="stat-label">{l}</span>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 450,
                letterSpacing: "-0.02em", lineHeight: 1, marginTop: 6,
              }}>
                {v}<small style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", marginLeft: 4, fontWeight: "normal" }}>{u}</small>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Queue depth by camp</h3>
              <span className="card-eyebrow">Live · from SmugMug</span>
            </div>
            {([
              ["Game Dev · Stanford", 412, "sun"],
              ["Robotics · UCLA",     389, "lake"],
              ["AI & ML · MIT",       521, "moss"],
              ["Film · NYU",          298, "rose"],
              ["Roblox · Caltech",    602, "ink-2"],
              ["Creative · USC",      259, "ink-3"],
            ] as [string, number, string][]).map(([camp, n, c]) => {
              const max = 602;
              return (
                <div key={camp} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color: "var(--ink-2)" }}>{camp}</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>{n} photos</span>
                  </div>
                  <div className="progress-track" style={{ height: 8 }}>
                    <div className="progress-fill" style={{ width: ((n/max)*100)+"%", background: `var(--${c})` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Flagged for review</h3>
              <span className="pill pill-sun">14 open</span>
            </div>
            {([
              ["IMG_4612", "Riley T.",   "Gesture unclear"],
              ["IMG_4590", "Marcus W.",  "Could be hero shot?"],
              ["IMG_4588", "Ana F.",     "Lighting borderline"],
              ["IMG_4571", "Priya S.",   "Duplicate of 4570?"],
            ] as [string, string, string][]).map(([id, who, note]) => (
              <div key={id} style={{ padding: "10px 0", borderTop: "1px solid var(--rule)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{id}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{who}</span>
                </div>
                <div style={{ color: "var(--ink-3)", fontSize: 12 }}>{note}</div>
              </div>
            ))}
            <button className="btn btn-ghost" style={{ width: "100%", marginTop: 10 }}>
              Review all flags <Icon name="arrow-r" size={12} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function AdminAssignment() {
  const [batchSize, setBatchSize] = React.useState(10);
  const [reminderDays, setReminderDays] = React.useState(2);
  const [remindersOn, setRemindersOn] = React.useState(true);
  const [suppressWeekends, setSuppressWeekends] = React.useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Assignment"
        title="How photos <em>flow.</em>"
        sub="Control how the queue is sliced up across reviewers."
      >
        <button className="btn btn-ghost">Discard</button>
        <button className="btn btn-primary">Save changes</button>
      </PageHeader>

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Batch settings</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label className="label">Photos per batch</label>
                <input type="range" min="5" max="25" value={batchSize}
                  onChange={(e) => setBatchSize(+e.target.value)}
                  style={{ width: "100%" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                  <span>5</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, color: "var(--ink)" }}>{batchSize}</span>
                  <span>25</span>
                </div>
              </div>
              <div>
                <label className="label">Auto-reassign after</label>
                <select className="select" defaultValue="30">
                  <option value="30">30 minutes of inactivity</option>
                  <option value="60">1 hour of inactivity</option>
                  <option value="120">2 hours of inactivity</option>
                  <option value="240">4 hours of inactivity</option>
                  <option value="480">8 hours of inactivity</option>
                  <option value="1440">1 day of inactivity</option>
                  <option value="2880">2 days of inactivity</option>
                  <option value="4320">3 days of inactivity</option>
                  <option value="10080">1 week of inactivity</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              gap: 12, marginBottom: 14,
            }}>
              <div>
                <h3 className="card-title" style={{ marginBottom: 6 }}>Reminders</h3>
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                  Nudge inactive reviewers via email + in-app.
                </div>
              </div>
              <Toggle value={remindersOn} onChange={setRemindersOn} />
            </div>

            <div style={{
              opacity: remindersOn ? 1 : 0.45,
              pointerEvents: remindersOn ? "auto" : "none",
              transition: "opacity 0.15s",
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label className="label">Remind after inactivity</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="range" min="1" max="14" value={reminderDays}
                      onChange={(e) => setReminderDays(+e.target.value)}
                      style={{ flex: 1 }} />
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500, minWidth: 64 }}>
                      {reminderDays}d
                    </span>
                  </div>
                </div>
                <div>
                  <label className="label">Channels</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="tag-chip active">Email</button>
                    <button className="tag-chip active">In-app</button>
                    <button className="tag-chip">Slack</button>
                    <button className="tag-chip">SMS</button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 4 }}>
                <ToggleRow
                  label="Suppress on weekends"
                  hint="Skip reminders on Saturday and Sunday."
                  value={suppressWeekends}
                  onChange={setSuppressWeekends}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ background: "var(--lake-soft)", borderColor: "transparent" }}>
            <div className="card-eyebrow">Preview</div>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
              Each active reviewer will receive batches of <strong>{batchSize} photos</strong>.{" "}
              {remindersOn
                ? <>Reviewers idle for <strong>{reminderDays} days</strong> get a nudge{suppressWeekends ? " (weekends skipped)" : ""}.</>
                : <>Reminders are <strong>off</strong>.</>
              }{" "}
              At current queue depth of <strong>2,481</strong>, you&apos;ll clear it in <strong>~5.3 hours</strong> with 31 active reviewers.
            </div>
          </div>

          <FlagNotifications />
        </div>
      </div>
    </>
  );
}

type FlagRule = {
  id: number;
  name: string;
  reasons: string[];
  recipient: string;
  channels: string[];
};

function FlagNotifications() {
  const ALL_REASONS = [
    { id: "inappropriate", label: "Inappropriate" },
    { id: "gesture",       label: "Gesture" },
    { id: "consent",       label: "Consent" },
    { id: "minor-ident",   label: "Identifying info" },
    { id: "second-opinion",label: "Second opinion" },
    { id: "safety",        label: "Safety" },
  ];
  const ADMINS = ["Dr. Harper Rowe", "Ana Flores (Lead)", "Ops on-call", "Safety team"];

  const [rules, setRules] = React.useState<FlagRule[]>([
    { id: 1, name: "Safety escalation",
      reasons: ["inappropriate","safety","minor-ident"],
      recipient: "Safety team",
      channels: ["email","slack","sms"] },
    { id: 2, name: "Daily digest",
      reasons: ["gesture","consent","second-opinion"],
      recipient: "Dr. Harper Rowe",
      channels: ["email"] },
  ]);
  const [open, setOpen] = React.useState<number | null>(null);

  const addRule = () => {
    const id = Date.now();
    setRules([...rules, {
      id, name: "New rule", reasons: [],
      recipient: ADMINS[0], channels: ["email"],
    }]);
    setOpen(id);
  };
  const updateRule = (id: number, patch: Partial<FlagRule>) =>
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRule = (id: number) => setRules(rs => rs.filter(r => r.id !== id));
  const toggleIn = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const CHANNEL_META: Record<string, { label: string; icon: string }> = {
    email: { label: "Email", icon: "mail" },
    slack: { label: "Slack", icon: "bell" },
    sms:   { label: "SMS",   icon: "phone" },
    inapp: { label: "In-app",icon: "bell" },
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h3 className="card-title">Flag notifications</h3>
        <span className="pill pill-sun">{rules.length} active</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
        Who gets pinged when reviewers flag a photo.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rules.map(r => (
          <div key={r.id} style={{
            border: "1px solid var(--rule)",
            borderRadius: 8,
            overflow: "hidden",
            background: "var(--paper)",
          }}>
            <div style={{
              padding: "10px 12px",
              display: "flex", alignItems: "center", gap: 10,
              cursor: "pointer",
            }}
              onClick={() => setOpen(open === r.id ? null : r.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.reasons.length || "no"} reason{r.reasons.length === 1 ? "" : "s"} → {r.recipient} · {r.channels.join(", ")}
                </div>
              </div>
              <Icon name={open === r.id ? "chevron-d" : "chevron-r"} size={12} />
            </div>

            {open === r.id && (
              <div style={{
                padding: 12, borderTop: "1px solid var(--rule)",
                background: "var(--paper-2)",
                display: "flex", flexDirection: "column", gap: 12,
              }}>
                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Rule name</label>
                  <input className="input"
                    value={r.name}
                    onChange={(e) => updateRule(r.id, { name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label" style={{ marginBottom: 6 }}>Trigger on</label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {ALL_REASONS.map(reason => (
                      <button key={reason.id}
                        className={"tag-chip" + (r.reasons.includes(reason.id) ? " active" : "")}
                        onClick={() => updateRule(r.id, { reasons: toggleIn(r.reasons, reason.id) })}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Notify</label>
                  <select className="select"
                    value={r.recipient}
                    onChange={(e) => updateRule(r.id, { recipient: e.target.value })}
                  >
                    {ADMINS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label" style={{ marginBottom: 6 }}>Channels</label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {Object.entries(CHANNEL_META).map(([id, meta]) => (
                      <button key={id}
                        className={"tag-chip" + (r.channels.includes(id) ? " active" : "")}
                        onClick={() => updateRule(r.id, { channels: toggleIn(r.channels, id) })}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <button
                    onClick={() => removeRule(r.id)}
                    style={{ color: "var(--rose)", fontSize: 12, fontWeight: 500 }}
                  >
                    Delete rule
                  </button>
                  <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => setOpen(null)}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={addRule}
          style={{
            padding: "10px 12px",
            border: "1px dashed var(--rule-2)",
            borderRadius: 8,
            background: "transparent",
            color: "var(--ink-2)",
            fontSize: 13,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add notification rule
        </button>
      </div>
    </div>
  );
}

export function AdminPoints() {
  const [pts, setPts] = React.useState<Record<string, number>>({
    approve: 10, reject: 10, flag: 15, streakBonus: 25,
    teamWin: 100, accurateFlag: 15, perfectBatch: 50,
  });

  return (
    <>
      <PageHeader
        eyebrow="Admin · Points"
        title="Points &amp; <em>rules.</em>"
        sub="Tune the economy. Changes go live immediately."
      >
        <button className="btn btn-primary">Save</button>
      </PageHeader>

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Per-action points</h3>
            <div style={{ display: "grid", gap: 2 }}>
              {([
                ["approve", "Approve photo", "Standard approve action"],
                ["reject",  "Reject photo",  "Standard reject with valid reason tag"],
                ["flag",    "Flag for admin","Flagging earns more — we want you to ask"],
                ["accurateFlag", "Accurate flag bonus", "When admin agrees with your flag"],
                ["perfectBatch", "Perfect batch bonus", "All 10 decisions confirmed by admin"],
                ["streakBonus",  "Daily streak bonus", "Per day on a 3+ day streak"],
                ["teamWin",      "Team weekly win", "To every member of the winning team"],
              ] as [string, string, string][]).map(([key, label, note]) => (
                <div key={key} style={{
                  display: "grid", gridTemplateColumns: "1fr auto",
                  padding: "12px 0", borderBottom: "1px solid var(--rule)",
                  alignItems: "center", gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{note}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button className="btn btn-ghost" style={{ padding: "4px 10px" }}
                      onClick={() => setPts({ ...pts, [key]: Math.max(0, pts[key] - 5) })}>−</button>
                    <div style={{
                      fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
                      minWidth: 50, textAlign: "center",
                    }}>
                      {pts[key]}
                    </div>
                    <button className="btn btn-ghost" style={{ padding: "4px 10px" }}
                      onClick={() => setPts({ ...pts, [key]: pts[key] + 5 })}>+</button>
                    <span className="pill" style={{ marginLeft: 6 }}>pts</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <BonusEvents />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card" style={{ background: "var(--ink)", color: "var(--paper)", borderColor: "var(--ink)" }}>
            <div className="card-eyebrow" style={{ color: "color-mix(in oklch, var(--paper) 60%, transparent)" }}>Live impact</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 450, letterSpacing: "-0.02em", marginTop: 6 }}>
              Avg reviewer earns
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 56, fontWeight: 450, letterSpacing: "-0.03em", lineHeight: 1 }}>
              118<span style={{ fontSize: 20, opacity: 0.7 }}> pts/session</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
              Based on last 7 days · Up 12% from last week
            </div>
          </div>

          <TagLibrary />
        </div>
      </div>
    </>
  );
}

type TagRow = { id: string; label: string; type: "approve" | "reject" };

type BonusPeriodMode = "recurring" | "one-time";

type BonusPeriod = {
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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_SHORT  = ["S", "M", "T", "W", "T", "F", "S"];
const ALL_DAYS   = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS   = [1, 2, 3, 4, 5];

function formatTime12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m} ${period}`;
}

function formatDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 0) return "No days";
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 5 && sorted.every((d, i) => d === WEEKDAYS[i])) return "Weekdays";
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return "Weekends";
  return sorted.map(d => DAY_LABELS[d]).join(", ");
}

function formatDateTime(local: string): string {
  if (!local) return "—";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatOneTimeRange(startAt: string, endAt: string): string {
  if (!startAt || !endAt) return "—";
  const s = new Date(startAt);
  const e = new Date(endAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const dateFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)}–${e.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${s.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} → ${e.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
}

function roundedNowLocalInput(offsetMinutes: number = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BonusEvents() {
  const [periods, setPeriods] = React.useState<BonusPeriod[]>([
    {
      id: "bp_1",
      label: "Double-points hour",
      mode: "recurring",
      days: [...ALL_DAYS],
      startTime: "10:00",
      endTime: "11:00",
      startAt: "",
      endAt: "",
      multiplier: 2,
      enabled: true,
    },
  ]);
  const [editing, setEditing] = React.useState<BonusPeriod | null>(null);

  const startNew = () => setEditing({
    id: "bp_" + Date.now(),
    label: "",
    mode: "recurring",
    days: [...ALL_DAYS],
    startTime: "12:00",
    endTime: "13:00",
    startAt: roundedNowLocalInput(60),
    endAt: roundedNowLocalInput(120),
    multiplier: 2,
    enabled: true,
  });

  const save = (period: BonusPeriod) => {
    setPeriods(prev => {
      const exists = prev.some(p => p.id === period.id);
      return exists ? prev.map(p => p.id === period.id ? period : p) : [...prev, period];
    });
    setEditing(null);
  };

  const remove = (id: string) => {
    setPeriods(prev => prev.filter(p => p.id !== id));
    if (editing?.id === id) setEditing(null);
  };

  const toggle = (id: string) => {
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h3 className="card-title">Bonus events</h3>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
          {periods.filter(p => p.enabled).length} ACTIVE · {periods.length} TOTAL
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Multiply all points earned during a scheduled window.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {periods.length === 0 && !editing && (
          <div style={{
            padding: 20, borderRadius: "var(--radius-sm)",
            border: "1px dashed var(--rule-2)",
            textAlign: "center", fontSize: 13, color: "var(--ink-3)",
          }}>
            No bonus periods scheduled.
          </div>
        )}
        {periods.map(p => (
          <BonusPeriodRow
            key={p.id}
            period={p}
            onToggle={() => toggle(p.id)}
            onEdit={() => setEditing(p)}
            onRemove={() => remove(p.id)}
          />
        ))}
      </div>

      {editing ? (
        <BonusPeriodForm
          period={editing}
          existing={periods.some(p => p.id === editing.id)}
          onCancel={() => setEditing(null)}
          onSave={save}
          onRemove={() => remove(editing.id)}
        />
      ) : (
        <button
          onClick={startNew}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px dashed var(--rule-2)",
            borderRadius: 8,
            background: "transparent",
            color: "var(--ink-2)",
            fontSize: 13, fontWeight: 500,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Schedule a bonus period
        </button>
      )}
    </div>
  );
}

function BonusPeriodRow({
  period,
  onToggle,
  onEdit,
  onRemove,
}: {
  period: BonusPeriod;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const active = period.enabled;
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: "var(--radius-sm)",
      background: active ? "var(--sun-soft)" : "var(--paper-2)",
      border: "1px solid " + (active ? "transparent" : "var(--rule)"),
      display: "flex", alignItems: "center", gap: 12,
      opacity: active ? 1 : 0.7,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2, flexWrap: "wrap",
        }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 500 }}>
            {period.label || `${period.multiplier}× bonus`}
          </div>
          <span className="pill pill-sun" style={{ fontSize: 11 }}>
            {period.multiplier}×
          </span>
          <span className="pill" style={{ fontSize: 11 }}>
            {period.mode === "recurring" ? "Recurring" : "One-time"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
          {period.mode === "recurring"
            ? `${formatDays(period.days)} · ${formatTime12(period.startTime)}–${formatTime12(period.endTime)}`
            : formatOneTimeRange(period.startAt, period.endAt)}
        </div>
      </div>
      <button
        onClick={onEdit}
        className="btn btn-ghost"
        style={{ padding: "4px 10px", fontSize: 12 }}
      >
        Edit
      </button>
      <button
        onClick={onRemove}
        className="btn btn-ghost"
        style={{ padding: "4px 6px", color: "var(--ink-3)" }}
        title="Remove"
      >
        <Icon name="x" size={14} />
      </button>
      <Toggle value={period.enabled} onChange={onToggle} />
    </div>
  );
}

function BonusPeriodForm({
  period,
  existing,
  onCancel,
  onSave,
  onRemove,
}: {
  period: BonusPeriod;
  existing: boolean;
  onCancel: () => void;
  onSave: (p: BonusPeriod) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = React.useState<BonusPeriod>(period);

  const toggleDay = (d: number) => {
    setDraft(prev => ({
      ...prev,
      days: prev.days.includes(d)
        ? prev.days.filter(x => x !== d)
        : [...prev.days, d].sort((a, b) => a - b),
    }));
  };

  const presetDays = (preset: "all" | "weekdays" | "weekends") => {
    const days = preset === "all" ? [...ALL_DAYS] : preset === "weekdays" ? [...WEEKDAYS] : [0, 6];
    setDraft(prev => ({ ...prev, days }));
  };

  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(n => parseInt(n, 10));
    return h * 60 + m;
  };
  const recurringTimesValid = toMinutes(draft.endTime) > toMinutes(draft.startTime);
  const oneTimeDatesValid =
    !!draft.startAt && !!draft.endAt &&
    new Date(draft.endAt).getTime() > new Date(draft.startAt).getTime();
  const multiplierValid = draft.multiplier >= 1.1 && draft.multiplier <= 10;
  const daysValid = draft.days.length > 0;
  const canSave = draft.mode === "recurring"
    ? recurringTimesValid && multiplierValid && daysValid
    : oneTimeDatesValid && multiplierValid;

  return (
    <div style={{
      padding: 14,
      borderRadius: 8,
      background: "var(--paper-2)",
      border: "1px solid var(--rule)",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="card-eyebrow">{existing ? "Edit bonus period" : "New bonus period"}</div>
      </div>

      <FieldRow label="Label" hint="Optional — shown to reviewers during the bonus window.">
        <input
          className="input"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="e.g. Lunch rush"
          maxLength={40}
        />
      </FieldRow>

      <div>
        <label className="label" style={{ marginBottom: 6 }}>Schedule type</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {([
            ["recurring", "Recurring", "Repeats on selected days"],
            ["one-time",  "One-time",  "Specific start & end date"],
          ] as [BonusPeriodMode, string, string][]).map(([value, label, desc]) => {
            const on = draft.mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setDraft({ ...draft, mode: value })}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: on ? "1.5px solid var(--sun)" : "1px solid var(--rule)",
                  background: on ? "var(--sun-soft)" : "var(--paper)",
                  color: on ? "var(--ink)" : "var(--ink-2)",
                  textAlign: "left", cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: on ? 500 : 400, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {draft.mode === "recurring" ? (
        <>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <label className="label" style={{ marginBottom: 0 }}>Days</label>
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => presetDays("all")}>Every day</button>
                <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => presetDays("weekdays")}>Weekdays</button>
                <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => presetDays("weekends")}>Weekends</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {DAY_SHORT.map((letter, i) => {
                const on = draft.days.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    title={DAY_LABELS[i]}
                    style={{
                      padding: "8px 0",
                      borderRadius: 6,
                      border: on ? "1.5px solid var(--sun)" : "1px solid var(--rule)",
                      background: on ? "var(--sun-soft)" : "var(--paper)",
                      color: on ? "var(--ink)" : "var(--ink-2)",
                      fontFamily: "var(--font-display)", fontSize: 13,
                      fontWeight: on ? 500 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
            {!daysValid && (
              <div style={{ fontSize: 11, color: "var(--rose)", marginTop: 6 }}>
                Pick at least one day.
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <FieldRow label="Start time">
              <input
                className="input"
                type="time"
                value={draft.startTime}
                onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="End time">
              <input
                className="input"
                type="time"
                value={draft.endTime}
                onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="Multiplier" hint="1.1× – 10×">
              <MultiplierInput
                value={draft.multiplier}
                onChange={(v) => setDraft({ ...draft, multiplier: v })}
              />
            </FieldRow>
          </div>

          {!recurringTimesValid && (
            <div style={{ fontSize: 11, color: "var(--rose)", marginTop: -6 }}>
              End time must be after start time.
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FieldRow label="Starts">
              <input
                className="input"
                type="datetime-local"
                value={draft.startAt}
                onChange={(e) => setDraft({ ...draft, startAt: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="Ends">
              <input
                className="input"
                type="datetime-local"
                value={draft.endAt}
                onChange={(e) => setDraft({ ...draft, endAt: e.target.value })}
              />
            </FieldRow>
          </div>

          <FieldRow label="Multiplier" hint="1.1× – 10×">
            <MultiplierInput
              value={draft.multiplier}
              onChange={(v) => setDraft({ ...draft, multiplier: v })}
            />
          </FieldRow>

          {!oneTimeDatesValid && (
            <div style={{ fontSize: 11, color: "var(--rose)", marginTop: -6 }}>
              End must be after start.
            </div>
          )}
        </>
      )}

      <div style={{
        padding: 10, borderRadius: 6,
        background: "var(--sun-soft)",
        fontSize: 12, color: "var(--ink-2)",
        fontFamily: "var(--font-mono)",
      }}>
        Preview · {draft.mode === "recurring"
          ? `${formatDays(draft.days)} · ${formatTime12(draft.startTime)}–${formatTime12(draft.endTime)}`
          : formatOneTimeRange(draft.startAt, draft.endAt)
        } · {draft.multiplier}× points
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
        <div>
          {existing && (
            <button className="btn btn-ghost" onClick={onRemove}
              style={{ color: "var(--rose)", fontSize: 12 }}>
              Delete
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSave}
            style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
            onClick={() => onSave(draft)}
          >
            <Icon name="check" size={12} /> {existing ? "Save changes" : "Add bonus period"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MultiplierInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        className="input"
        type="number"
        step="0.5"
        min="1.1"
        max="10"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{ flex: 1 }}
      />
      <span style={{
        fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500,
        color: "var(--ink-2)",
      }}>×</span>
    </div>
  );
}

function TagLibrary() {
  const [tags, setTags] = React.useState<TagRow[]>([
    { id: "hero",          label: "Hero shot",          type: "approve" },
    { id: "group-energy",  label: "Group energy",       type: "approve" },
    { id: "activity",      label: "Activity context",   type: "approve" },
    { id: "blurry",        label: "Blurry",             type: "reject"  },
    { id: "bad-expression",label: "Bad expression",     type: "reject"  },
    { id: "messy-setup",   label: "Messy setup",        type: "reject"  },
    { id: "bad-lighting",  label: "Bad lighting",       type: "reject"  },
    { id: "inappropriate", label: "Inappropriate",      type: "reject"  },
  ]);
  const [adding, setAdding] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [newType, setNewType]   = React.useState<"approve" | "reject">("approve");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  const canSave = newLabel.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    const id = newLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    setTags([...tags, { id: id || "tag-" + Date.now(), label: newLabel.trim(), type: newType }]);
    setNewLabel("");
    setNewType("approve");
    setAdding(false);
  };
  const cancel = () => { setAdding(false); setNewLabel(""); setNewType("approve"); };
  const remove = (id: string) => setTags(ts => ts.filter(t => t.id !== id));

  const approve = tags.filter(t => t.type === "approve");
  const reject  = tags.filter(t => t.type === "reject");

  const chipStyle = (type: "approve" | "reject"): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 10px", borderRadius: 999,
    fontSize: 12, fontWeight: 500,
    background: type === "approve" ? "var(--moss-soft)" : "var(--rose-soft)",
    color:      type === "approve" ? "var(--moss)"      : "var(--rose)",
    border: "1px solid transparent",
  });

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 className="card-title">Tag library</h3>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
          {tags.length} TAGS
        </span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: "var(--moss)", marginBottom: 6 }}>
          Approve tags · positive
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {approve.map(t => (
            <span key={t.id} style={chipStyle("approve")}>
              {t.label}
              <button onClick={() => remove(t.id)} style={{
                marginLeft: 2, color: "var(--moss)", opacity: 0.6,
                display: "grid", placeItems: "center",
              }}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {approve.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
              No approve tags yet
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: "var(--rose)", marginBottom: 6 }}>
          Reject tags · reasons
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {reject.map(t => (
            <span key={t.id} style={chipStyle("reject")}>
              {t.label}
              <button onClick={() => remove(t.id)} style={{
                marginLeft: 2, color: "var(--rose)", opacity: 0.6,
                display: "grid", placeItems: "center",
              }}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {reject.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
              No reject tags yet
            </span>
          )}
        </div>
      </div>

      {adding ? (
        <div style={{
          marginTop: 8,
          padding: 12,
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
          borderRadius: 8,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Label</label>
            <input
              ref={inputRef}
              className="input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancel();
              }}
              placeholder="e.g. Candid moment"
              maxLength={32}
            />
          </div>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button
                onClick={() => setNewType("approve")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: newType === "approve" ? "1.5px solid var(--moss)" : "1px solid var(--rule)",
                  background: newType === "approve" ? "var(--moss-soft)" : "var(--paper)",
                  color: newType === "approve" ? "var(--moss)" : "var(--ink-2)",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, fontWeight: newType === "approve" ? 500 : 400,
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: "var(--moss)", flexShrink: 0,
                }} />
                Approve tag
              </button>
              <button
                onClick={() => setNewType("reject")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: newType === "reject" ? "1.5px solid var(--rose)" : "1px solid var(--rule)",
                  background: newType === "reject" ? "var(--rose-soft)" : "var(--paper)",
                  color: newType === "reject" ? "var(--rose)" : "var(--ink-2)",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, fontWeight: newType === "reject" ? 500 : 400,
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: "var(--rose)", flexShrink: 0,
                }} />
                Reject tag
              </button>
            </div>
          </div>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Preview</label>
            <span style={chipStyle(newType)}>
              {newLabel.trim() || "Tag label"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
            <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
            <button className="btn btn-primary" disabled={!canSave}
              style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
              onClick={save}>
              <Icon name="plus" size={12} /> Add tag
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px dashed var(--rule-2)",
            borderRadius: 8,
            background: "transparent",
            color: "var(--ink-2)",
            fontSize: 13, fontWeight: 500,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add tag
        </button>
      )}
    </div>
  );
}

export function AdminExamples() {
  const [tab, setTab] = React.useState<"good" | "bad">("good");
  const list = EXAMPLES[tab];

  return (
    <>
      <PageHeader
        eyebrow="Admin · Examples"
        title="Example <em>library.</em>"
        sub="What reviewers see in the guide and session drawer."
      >
        <button className="btn btn-primary">
          <Icon name="plus" size={14} /> Add example
        </button>
      </PageHeader>

      <div className="page-body">
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--paper-3)",
          borderRadius: 8, width: "fit-content", marginBottom: 20 }}>
          {([["good", `Good · ${EXAMPLES.good.length}`], ["bad", `Bad · ${EXAMPLES.bad.length}`]] as ["good" | "bad", string][]).map(([id, label]) => (
            <button key={id}
              onClick={() => setTab(id)}
              className="btn"
              style={{
                padding: "6px 14px", fontSize: 12,
                background: tab === id ? "var(--paper)" : "transparent",
                boxShadow: tab === id ? "var(--shadow-sm)" : "none",
              }}>{label}</button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {list.map((ex, i) => (
            <div key={ex.id} className="card" style={{ padding: 12 }}>
              <div style={{
                aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
                position: "relative", marginBottom: 10,
                border: `2px solid var(--${tab === "good" ? "moss" : "rose"})`,
                filter: tab === "bad" && i === 0 ? "blur(2px)" : "none",
              }}>
                <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: "" }} compact />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500 }}>
                    {ex.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {ex.id}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ padding: "4px 6px" }}>
                  <Icon name="dots" size={14} />
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.4 }}>
                {ex.note}
              </div>
            </div>
          ))}
          <button className="card" style={{
            border: "2px dashed var(--rule-2)",
            background: "transparent",
            display: "grid", placeItems: "center",
            minHeight: 220, cursor: "pointer",
            color: "var(--ink-3)",
          }}>
            <div style={{ textAlign: "center" }}>
              <Icon name="plus" size={24} />
              <div style={{ marginTop: 6, fontSize: 13 }}>Upload {tab} example</div>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

export function AdminUsers() {
  return (
    <>
      <PageHeader
        eyebrow="Admin · Users"
        title="<em>Reviewers.</em>"
        sub={`${ADMIN_USERS.length} accounts · 31 active in last 24h`}
      >
        <div style={{ position: "relative" }}>
          <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
          <input className="input" placeholder="Search…" style={{ paddingLeft: 30, width: 220 }} />
        </div>
        <button className="btn btn-primary"><Icon name="plus" size={14} /> Invite</button>
      </PageHeader>

      <div className="page-body">
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Team</th>
                <th>Last active</th>
                <th>Status</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {ADMIN_USERS.map(u => (
                <tr key={u.email}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                        {u.name.split(" ").map(n => n[0]).slice(0,2).join("")}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={"pill " + (u.role === "Admin" ? "pill-sun" : u.role === "Lead" ? "pill-lake" : "")}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{u.team}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>{u.last}</td>
                  <td>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: u.status === "Active" ? "var(--moss)" : "var(--rule-2)",
                      }} />
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost" style={{ padding: "4px 6px" }}>
                      <Icon name="dots" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11,
        background: value ? "var(--moss)" : "var(--rule-2)",
        position: "relative", transition: "all 0.2s",
        flexShrink: 0,
      }}
      aria-pressed={value}
    >
      <div style={{
        position: "absolute", top: 2, left: value ? 20 : 2,
        width: 18, height: 18, borderRadius: "50%",
        background: "white", transition: "all 0.2s",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="label" style={{ marginBottom: 0 }}>{label}</label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 0", borderBottom: "1px solid var(--rule)", gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

const ACCENT_OPTIONS: { id: AppSettings["accent"]; label: string; color: string }[] = [
  { id: "sun",  label: "Sun",  color: "oklch(0.72 0.17 55)" },
  { id: "lake", label: "Lake", color: "oklch(0.58 0.11 230)" },
  { id: "moss", label: "Moss", color: "oklch(0.55 0.12 155)" },
  { id: "rose", label: "Rose", color: "oklch(0.62 0.16 25)" },
];

export function AdminSettings() {
  const { settings, update, reset } = useSettings();
  const { firstName } = useCurrentUser();
  const previewName = firstName || "Riley";
  const [confirmReset, setConfirmReset] = React.useState(false);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    update({ [key]: value } as Partial<AppSettings>);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Settings"
        title="App <em>settings.</em>"
        sub="Branding, copy, and feature flags. Changes save automatically."
      >
        {confirmReset ? (
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button className="btn btn-primary"
              style={{ background: "var(--rose)" }}
              onClick={() => { reset(); setConfirmReset(false); }}>
              Confirm reset
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmReset(true)}>
            Reset to defaults
          </button>
        )}
      </PageHeader>

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Branding</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Shown in the sidebar and in browser tab.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 14 }}>
              <FieldRow label="App name">
                <input className="input"
                  value={settings.brandName}
                  onChange={(e) => set("brandName", e.target.value)}
                  maxLength={32} />
              </FieldRow>
              <FieldRow label="Tagline">
                <input className="input"
                  value={settings.brandTagline}
                  onChange={(e) => set("brandTagline", e.target.value)}
                  maxLength={48} />
              </FieldRow>
              <FieldRow label="Mark" hint="1 char">
                <input className="input"
                  style={{ textAlign: "center", fontFamily: "var(--font-display)", fontSize: 20 }}
                  value={settings.brandMark}
                  onChange={(e) => set("brandMark", e.target.value.slice(0, 2))}
                  maxLength={2} />
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Reviewer copy</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              The text reviewers see on the home screen.
              Use <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--paper-3)", padding: "1px 4px", borderRadius: 3 }}>{"{name}"}</code> and{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--paper-3)", padding: "1px 4px", borderRadius: 3 }}>{"{count}"}</code> as placeholders.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <FieldRow label="Home greeting" hint={`{name} is replaced with the reviewer's first name from their Google profile. Currently signed in as ${previewName}.`}>
                <input className="input"
                  value={settings.homeGreeting}
                  onChange={(e) => set("homeGreeting", e.target.value)}
                  maxLength={120} />
              </FieldRow>
              <FieldRow label="Home subtitle">
                <input className="input"
                  value={settings.homeSubtitle}
                  onChange={(e) => set("homeSubtitle", e.target.value)}
                  maxLength={160} />
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Completion + empty states</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
                <FieldRow label="Completion pennant" hint="Shown above the points total.">
                  <input className="input"
                    value={settings.completionTitle}
                    onChange={(e) => set("completionTitle", e.target.value)}
                    maxLength={40} />
                </FieldRow>
                <FieldRow label="Completion message">
                  <input className="input"
                    value={settings.completionMessage}
                    onChange={(e) => set("completionMessage", e.target.value)}
                    maxLength={120} />
                </FieldRow>
              </div>
              <FieldRow label="Empty queue message" hint="Shown when there are no photos waiting.">
                <input className="input"
                  value={settings.emptyQueueMessage}
                  onChange={(e) => set("emptyQueueMessage", e.target.value)}
                  maxLength={160} />
              </FieldRow>
              <FieldRow label="Support email" hint="Where reviewers go for help.">
                <input className="input" type="email"
                  value={settings.supportEmail}
                  onChange={(e) => set("supportEmail", e.target.value)} />
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Appearance</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FieldRow label="Theme">
                <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--paper-3)",
                  borderRadius: 8, width: "fit-content" }}>
                  {(["light","dark"] as const).map(t => (
                    <button key={t}
                      onClick={() => set("theme", t)}
                      className="btn"
                      style={{
                        padding: "6px 14px", fontSize: 12, textTransform: "capitalize",
                        background: settings.theme === t ? "var(--paper)" : "transparent",
                        boxShadow: settings.theme === t ? "var(--shadow-sm)" : "none",
                      }}>{t}</button>
                  ))}
                </div>
              </FieldRow>

              <FieldRow label="Accent color">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ACCENT_OPTIONS.map(opt => (
                    <button key={opt.id}
                      onClick={() => set("accent", opt.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: settings.accent === opt.id ? "1.5px solid var(--ink)" : "1px solid var(--rule)",
                        background: settings.accent === opt.id ? "var(--paper-3)" : "var(--paper)",
                        cursor: "pointer", fontSize: 13,
                      }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: "50%",
                        background: opt.color, flexShrink: 0,
                      }} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FieldRow>

              <FieldRow label="Density">
                <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--paper-3)",
                  borderRadius: 8, width: "fit-content" }}>
                  {(["comfortable","compact"] as const).map(d => (
                    <button key={d}
                      onClick={() => set("density", d)}
                      className="btn"
                      style={{
                        padding: "6px 14px", fontSize: 12, textTransform: "capitalize",
                        background: settings.density === d ? "var(--paper)" : "transparent",
                        boxShadow: settings.density === d ? "var(--shadow-sm)" : "none",
                      }}>{d}</button>
                  ))}
                </div>
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Features</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
              Toggle gamification and engagement features on or off for everyone.
            </div>
            <ToggleRow
              label="Confetti on batch complete"
              hint="Celebrate when a reviewer finishes a batch."
              value={settings.confettiOnComplete}
              onChange={(v) => set("confettiOnComplete", v)}
            />
            <ToggleRow
              label="Stats &amp; leaderboard"
              hint="Show the leaderboard nav item and the stats link on the home screen."
              value={settings.showLeaderboard}
              onChange={(v) => set("showLeaderboard", v)}
            />
            <ToggleRow
              label="Streaks"
              hint="Show daily streak callouts and badges."
              value={settings.showStreaks}
              onChange={(v) => set("showStreaks", v)}
            />
            <ToggleRow
              label="Double-points hour"
              hint="Show the double-points pennant on the home screen."
              value={settings.showDoublePoints}
              onChange={(v) => set("showDoublePoints", v)}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 20, alignSelf: "start" }}>
          <div className="card">
            <div className="card-eyebrow">Live preview</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, marginBottom: 14 }}>
              How your changes look right now.
            </div>

            <div style={{
              padding: 14, borderRadius: "var(--radius-sm)",
              background: "var(--paper-2)", border: "1px solid var(--rule)",
              display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            }}>
              <div className="brand-mark" style={{ flexShrink: 0 }}>
                <span>{settings.brandMark}</span>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="brand-name" style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {settings.brandName}
                </div>
                <div className="brand-tag" style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {settings.brandTagline}
                </div>
              </div>
            </div>

            <div style={{
              padding: 16, borderRadius: "var(--radius-sm)",
              background: "var(--paper)", border: "1px solid var(--rule)",
            }}>
              <div className="page-eyebrow" style={{ marginBottom: 6 }}>
                Home screen
              </div>
              <div style={{
                fontFamily: "var(--font-display)", fontSize: 22,
                fontWeight: 450, letterSpacing: "-0.02em", lineHeight: 1.15,
                marginBottom: 6,
              }}>
                {settings.homeGreeting.replace(/\{name\}/g, previewName)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                {settings.homeSubtitle
                  .replace(/\{name\}/g, previewName)
                  .replace(/\{count\}/g, "10")}
              </div>
            </div>
          </div>

          <div className="card" style={{ background: "var(--lake-soft)", borderColor: "transparent" }}>
            <div className="card-eyebrow">About</div>
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
              Settings persist in this browser. In production, sync these to your backend so every reviewer sees the same brand and copy.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
