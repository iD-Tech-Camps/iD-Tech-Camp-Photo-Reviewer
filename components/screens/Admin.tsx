"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { useSettings, AppSettings, BonusPeriod, BonusPeriodMode } from "@/components/settings";
import { useCurrentUser, ROLE_LABEL } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import { fetchReviewerRoster, updateReviewerProfile, type ReviewerStats } from "@/lib/profile";
import type { Role } from "@/lib/current-user";
import {
  createTag,
  deleteTag,
  fetchTags,
  setTagActive,
  slugifyTagId,
  type Tag,
} from "@/lib/tags";
import {
  fetchPointsConfig,
  updatePointsConfig,
  type PointsConfig,
} from "@/lib/points-config";
import { useBonusPeriods } from "@/components/settings";
import {
  createExample,
  deleteExample,
  fetchExamples,
  reorderExamples,
  replaceExampleImage,
  updateExampleMetadata,
  type Example,
  type ExampleKind,
} from "@/lib/examples";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  const supabase = React.useMemo(() => createClient(), []);
  const [config, setConfig] = React.useState<PointsConfig | null>(null);
  const [draft, setDraft] = React.useState<PointsConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchPointsConfig(supabase)
      .then((row) => {
        if (cancelled) return;
        setConfig(row);
        setDraft(row);
      })
      .catch((err) => {
        console.error("[admin-points] fetch failed:", err);
        if (!cancelled) setSaveError(err?.message ?? "Couldn't load points config");
      });
    return () => { cancelled = true; };
  }, [supabase]);

  const dirty = draft !== null && config !== null && (
    draft.approvePoints !== config.approvePoints ||
    draft.flagPoints    !== config.flagPoints    ||
    draft.deletePoints  !== config.deletePoints
  );

  const save = async () => {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updatePointsConfig(supabase, draft);
      setConfig(updated);
      setDraft(updated);
    } catch (err: any) {
      console.error("[admin-points] save failed:", err);
      setSaveError(err?.message ?? "Couldn't save points config");
    } finally {
      setSaving(false);
    }
  };

  const adjust = (key: keyof PointsConfig, delta: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = Math.max(0, prev[key] + delta);
      return { ...prev, [key]: next };
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Points"
        title="Points &amp; <em>rules.</em>"
        sub={config === null ? "Loading current points config…" : "Tune the economy. Click Save to push changes live."}
      >
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!dirty || saving}
          style={{ opacity: dirty && !saving ? 1 : 0.5, cursor: dirty && !saving ? "pointer" : "not-allowed" }}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </PageHeader>

      {saveError && (
        <div className="page-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div style={{
            padding: 12, marginBottom: 14,
            border: "1px solid var(--rose)", borderRadius: 8,
            background: "var(--rose-soft)", color: "var(--rose)",
            fontSize: 13,
          }}>
            {saveError}
          </div>
        </div>
      )}

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Per-action points</h3>
            <div style={{ display: "grid", gap: 2 }}>
              {([
                ["approvePoints", "Approve photo", "Standard approve action"],
                ["flagPoints",    "Flag for senior", "Flag anything that isn't a clear approve — a senior makes the final call"],
              ] as [keyof PointsConfig, string, string][]).map(([key, label, note]) => (
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
                      onClick={() => adjust(key, -5)}
                      disabled={draft === null}>−</button>
                    <div style={{
                      fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
                      minWidth: 50, textAlign: "center",
                    }}>
                      {draft ? draft[key] : "—"}
                    </div>
                    <button className="btn btn-ghost" style={{ padding: "4px 10px" }}
                      onClick={() => adjust(key, 5)}
                      disabled={draft === null}>+</button>
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
  const { periods, hydrated, saveError, create, update, remove: removePeriod, toggle: togglePeriod } =
    useBonusPeriods();
  const [editing, setEditing] = React.useState<BonusPeriod | null>(null);

  const startNew = () => setEditing({
    id: "",
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

  const save = async (period: BonusPeriod) => {
    // The form's `existing` flag is the source of truth for create-vs-update;
    // pass it via the second arg so we don't have to re-derive it here.
    if (period.id && periods.some((p) => p.id === period.id)) {
      await update(period.id, period);
    } else {
      const { id: _omit, ...rest } = period;
      await create(rest);
    }
    setEditing(null);
  };

  const remove = async (id: string) => {
    await removePeriod(id);
    if (editing?.id === id) setEditing(null);
  };

  const toggle = async (id: string, enabled: boolean) => {
    await togglePeriod(id, enabled);
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h3 className="card-title">Points multiplier bonus</h3>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
          {hydrated
            ? `${periods.filter(p => p.enabled).length} ACTIVE · ${periods.length} TOTAL`
            : "LOADING…"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
        Schedule windows where all earned points are multiplied. Reviewers see a pennant during active windows.
      </div>

      {saveError && (
        <div style={{
          padding: 10, marginBottom: 12,
          border: "1px solid var(--rose)", borderRadius: 6,
          background: "var(--rose-soft)", color: "var(--rose)",
          fontSize: 12,
        }}>
          {saveError}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {hydrated && periods.length === 0 && !editing && (
          <div style={{
            padding: 20, borderRadius: "var(--radius-sm)",
            border: "1px dashed var(--rule-2)",
            textAlign: "center", fontSize: 13, color: "var(--ink-3)",
          }}>
            No multiplier bonuses scheduled.
          </div>
        )}
        {periods.map(p => (
          <BonusPeriodRow
            key={p.id}
            period={p}
            onToggle={() => toggle(p.id, !p.enabled)}
            onEdit={() => setEditing(p)}
            onRemove={() => remove(p.id)}
          />
        ))}
      </div>

      {editing ? (
        <BonusPeriodForm
          period={editing}
          existing={!!editing.id && periods.some(p => p.id === editing.id)}
          onCancel={() => setEditing(null)}
          onSave={save}
          onRemove={() => editing.id && remove(editing.id)}
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
          <Icon name="plus" size={12} /> Schedule a multiplier bonus
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
  onSave: (p: BonusPeriod) => void | Promise<void>;
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
        <div className="card-eyebrow">{existing ? "Edit multiplier bonus" : "New multiplier bonus"}</div>
      </div>

      <FieldRow label="Label" hint="Optional — shown to reviewers in the pennant during the active window.">
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
            <Icon name="check" size={12} /> {existing ? "Save changes" : "Add multiplier bonus"}
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

// Live-DB tag library. Loads `tags` rows on mount and writes admin
// changes (create / soft-delete / hard-delete) directly via lib/tags.
// Both ReviewScreen and FlagReview consume the same table, so anything an
// admin does here flows through to reviewers on their next page load.
//
// Delete strategy: try a hard delete first; if Postgres rejects it because
// a `review_tags` row references the tag (FK is `on delete restrict`), fall
// back to flipping `active = false` so the tag stops showing in the review
// modals while preserving historical flag-row labels.
function TagLibrary() {
  const [tags, setTags] = React.useState<Tag[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [newKind, setNewKind] = React.useState<"positive" | "negative">("positive");
  const [busy, setBusy] = React.useState(false);
  const [opError, setOpError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    let cancelled = false;
    fetchTags(supabase)
      .then((rows) => { if (!cancelled) setTags(rows); })
      .catch((err) => {
        console.error("[admin-tags] fetch failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load tags");
          setTags([]);
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  React.useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  const activeTags = (tags ?? []).filter((t) => t.active);
  const positives = activeTags.filter((t) => t.kind === "positive");
  const negatives = activeTags.filter((t) => t.kind === "negative");

  const canSave = newLabel.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    const label = newLabel.trim();
    const slug = slugifyTagId(label) || `tag-${Date.now()}`;
    if ((tags ?? []).some((t) => t.id === slug)) {
      setOpError(`A tag with id "${slug}" already exists. Try a different label.`);
      return;
    }
    setBusy(true);
    setOpError(null);
    try {
      const nextOrder = Math.max(0, ...activeTags
        .filter((t) => t.kind === newKind)
        .map((t) => t.displayOrder)) + 1;
      const created = await createTag(supabase, {
        id: slug, label, kind: newKind, displayOrder: nextOrder,
      });
      setTags((prev) => [...(prev ?? []), created]);
      setNewLabel("");
      setNewKind("positive");
      setAdding(false);
    } catch (err: any) {
      console.error("[admin-tags] create failed:", err);
      setOpError(err?.message ?? "Couldn't create tag");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setAdding(false);
    setNewLabel("");
    setNewKind("positive");
    setOpError(null);
  };

  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setOpError(null);
    try {
      await deleteTag(supabase, id);
      setTags((prev) => (prev ?? []).filter((t) => t.id !== id));
    } catch (err: any) {
      // FK-restrict on review_tags → fall back to soft-delete.
      const code = err?.code ?? "";
      const looksLikeFkViolation = code === "23503" ||
        /violates foreign key/i.test(err?.message ?? "");
      if (looksLikeFkViolation) {
        try {
          await setTagActive(supabase, id, false);
          setTags((prev) =>
            (prev ?? []).map((t) => (t.id === id ? { ...t, active: false } : t)),
          );
        } catch (softErr: any) {
          console.error("[admin-tags] soft-delete failed:", softErr);
          setOpError(softErr?.message ?? "Couldn't deactivate tag");
        }
      } else {
        console.error("[admin-tags] delete failed:", err);
        setOpError(err?.message ?? "Couldn't remove tag");
      }
    } finally {
      setBusy(false);
    }
  };

  const chipStyle = (kind: "positive" | "negative"): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 10px", borderRadius: 999,
    fontSize: 12, fontWeight: 500,
    background: kind === "positive" ? "var(--moss-soft)" : "var(--sun-soft)",
    color:      kind === "positive" ? "var(--moss)"      : "var(--sun)",
    border: "1px solid transparent",
  });

  const headerCount = tags === null ? "…" : `${activeTags.length} TAGS`;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h3 className="card-title">Tag library</h3>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
          {headerCount}
        </span>
      </div>

      {loadError && (
        <div style={{
          padding: 10, marginBottom: 12,
          border: "1px solid var(--rose)", borderRadius: 6,
          background: "var(--rose-soft)", color: "var(--rose)",
          fontSize: 12,
        }}>
          Couldn&apos;t load tags: {loadError}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: "var(--moss)", marginBottom: 6 }}>
          Approve tags · positive
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {positives.map(t => (
            <span key={t.id} style={chipStyle("positive")}>
              {t.label}
              <button
                onClick={() => remove(t.id)}
                disabled={busy}
                style={{
                  marginLeft: 2, color: "var(--moss)", opacity: busy ? 0.3 : 0.6,
                  display: "grid", placeItems: "center",
                  cursor: busy ? "not-allowed" : "pointer",
                }}
                title="Remove"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {tags !== null && positives.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
              No approve tags yet
            </span>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: "var(--sun)", marginBottom: 6 }}>
          Flag tags · reasons
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {negatives.map(t => (
            <span key={t.id} style={chipStyle("negative")}>
              {t.label}
              <button
                onClick={() => remove(t.id)}
                disabled={busy}
                style={{
                  marginLeft: 2, color: "var(--sun)", opacity: busy ? 0.3 : 0.6,
                  display: "grid", placeItems: "center",
                  cursor: busy ? "not-allowed" : "pointer",
                }}
                title="Remove"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {tags !== null && negatives.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>
              No flag tags yet
            </span>
          )}
        </div>
      </div>

      {opError && (
        <div style={{
          padding: 10, marginBottom: 12,
          border: "1px solid var(--rose)", borderRadius: 6,
          background: "var(--rose-soft)", color: "var(--rose)",
          fontSize: 12,
        }}>
          {opError}
        </div>
      )}

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
              maxLength={48}
            />
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
              id: {slugifyTagId(newLabel) || "—"}
            </div>
          </div>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button
                onClick={() => setNewKind("positive")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: newKind === "positive" ? "1.5px solid var(--moss)" : "1px solid var(--rule)",
                  background: newKind === "positive" ? "var(--moss-soft)" : "var(--paper)",
                  color: newKind === "positive" ? "var(--moss)" : "var(--ink-2)",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, fontWeight: newKind === "positive" ? 500 : 400,
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: "var(--moss)", flexShrink: 0,
                }} />
                Approve tag
              </button>
              <button
                onClick={() => setNewKind("negative")}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: newKind === "negative" ? "1.5px solid var(--sun)" : "1px solid var(--rule)",
                  background: newKind === "negative" ? "var(--sun-soft)" : "var(--paper)",
                  color: newKind === "negative" ? "var(--sun)" : "var(--ink-2)",
                  textAlign: "left", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 13, fontWeight: newKind === "negative" ? 500 : 400,
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: "var(--sun)", flexShrink: 0,
                }} />
                Flag tag
              </button>
            </div>
          </div>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Preview</label>
            <span style={chipStyle(newKind)}>
              {newLabel.trim() || "Tag label"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
            <button className="btn btn-ghost" onClick={cancel} disabled={busy}>Cancel</button>
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
          disabled={tags === null}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px dashed var(--rule-2)",
            borderRadius: 8,
            background: "transparent",
            color: "var(--ink-2)",
            fontSize: 13, fontWeight: 500,
            cursor: tags === null ? "wait" : "pointer",
            opacity: tags === null ? 0.5 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add tag
        </button>
      )}
    </div>
  );
}

// 10MB client-side cap. Storage RLS enforces admin-only writes, but we
// guard at the file-picker layer with a friendly message so admins don't
// have to wait for the round-trip to learn an upload was rejected.
const MAX_EXAMPLE_FILE_BYTES = 10 * 1024 * 1024;

type ExamplesByKind = Record<ExampleKind, Example[]>;

type ExampleModalState =
  | { kind: "closed" }
  | { kind: "upload"; presetKind: ExampleKind }
  | { kind: "edit"; example: Example }
  | { kind: "replace"; example: Example }
  | { kind: "delete"; example: Example };

export function AdminExamples({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [tab, setTab] = React.useState<ExampleKind>("good");
  const [byKind, setByKind] = React.useState<ExamplesByKind | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<ExampleModalState>({ kind: "closed" });
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await fetchExamples(supabase);
      const grouped: ExamplesByKind = { good: [], bad: [] };
      for (const r of rows) grouped[r.kind].push(r);
      setByKind(grouped);
    } catch (err: any) {
      console.error("[admin-examples] fetch failed:", err);
      setLoadError(err?.message ?? "Failed to load examples");
      setByKind({ good: [], bad: [] });
    }
  }, [supabase]);

  React.useEffect(() => {
    let cancelled = false;
    fetchExamples(supabase)
      .then((rows) => {
        if (cancelled) return;
        const grouped: ExamplesByKind = { good: [], bad: [] };
        for (const r of rows) grouped[r.kind].push(r);
        setByKind(grouped);
      })
      .catch((err) => {
        console.error("[admin-examples] fetch failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load examples");
          setByKind({ good: [], bad: [] });
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  const list = byKind?.[tab] ?? [];
  const counts = {
    good: byKind?.good.length ?? 0,
    bad:  byKind?.bad.length  ?? 0,
  };

  // ── mutations ──────────────────────────────────────────────────────────

  const handleUpload = async (kind: ExampleKind, label: string, note: string, file: File) => {
    try {
      const created = await createExample(supabase, { kind, label, note, file });
      setByKind((prev) => {
        const base = prev ?? { good: [], bad: [] };
        return { ...base, [kind]: [...base[kind], created] };
      });
      toast.show?.(`Uploaded "${created.label}"`, "check");
      setModal({ kind: "closed" });
    } catch (err: any) {
      console.error("[admin-examples] create failed:", err);
      toast.show?.(err?.message ? `Upload failed: ${err.message}` : "Upload failed.");
    }
  };

  const handleEditMetadata = async (
    example: Example,
    patch: { label: string; note: string; kind: ExampleKind },
  ) => {
    try {
      const updated = await updateExampleMetadata(supabase, example.id, patch);
      setByKind((prev) => {
        if (!prev) return prev;
        // If kind changed, move between buckets. Otherwise replace in-place.
        if (updated.kind === example.kind) {
          return {
            ...prev,
            [example.kind]: prev[example.kind].map((e) => (e.id === updated.id ? updated : e)),
          };
        }
        return {
          ...prev,
          [example.kind]: prev[example.kind].filter((e) => e.id !== example.id),
          [updated.kind]: [...prev[updated.kind], updated],
        };
      });
      toast.show?.("Saved.", "check");
      setModal({ kind: "closed" });
    } catch (err: any) {
      console.error("[admin-examples] update failed:", err);
      toast.show?.(err?.message ? `Save failed: ${err.message}` : "Save failed.");
    }
  };

  const handleReplace = async (example: Example, file: File) => {
    try {
      const updated = await replaceExampleImage(supabase, example.id, file);
      setByKind((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [updated.kind]: prev[updated.kind].map((e) => (e.id === updated.id ? updated : e)),
        };
      });
      toast.show?.("Image replaced.", "check");
      setModal({ kind: "closed" });
    } catch (err: any) {
      console.error("[admin-examples] replace failed:", err);
      toast.show?.(err?.message ? `Replace failed: ${err.message}` : "Replace failed.");
    }
  };

  const handleDelete = async (example: Example) => {
    try {
      await deleteExample(supabase, example.id);
      setByKind((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [example.kind]: prev[example.kind].filter((e) => e.id !== example.id),
        };
      });
      toast.show?.(`Deleted "${example.label}"`, "x");
      setModal({ kind: "closed" });
    } catch (err: any) {
      console.error("[admin-examples] delete failed:", err);
      toast.show?.(err?.message ? `Delete failed: ${err.message}` : "Delete failed.");
    }
  };

  const handleReorder = async (kind: ExampleKind, nextOrder: Example[]) => {
    // Optimistic update. Snapshot the previous list so we can roll back on
    // failure — the persistence layer is a single RPC, so a half-applied
    // ordering shouldn't be possible, but the user could still see a stale
    // local state if the network drops.
    const previous = byKind?.[kind] ?? [];
    setByKind((prev) => {
      const base = prev ?? { good: [], bad: [] };
      return { ...base, [kind]: nextOrder };
    });
    try {
      await reorderExamples(supabase, kind, nextOrder.map((e) => e.id));
    } catch (err: any) {
      console.error("[admin-examples] reorder failed:", err);
      setByKind((prev) => {
        if (!prev) return prev;
        return { ...prev, [kind]: previous };
      });
      toast.show?.(err?.message ? `Reorder failed: ${err.message}` : "Reorder failed.");
    }
  };

  // ── render ────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        eyebrow="Admin · Examples"
        title="Example <em>library.</em>"
        sub={byKind === null
          ? "Loading examples…"
          : "What reviewers see in the guide. Drag to reorder within a tab."}
      />

      <div className="page-body">
        {loadError && (
          <div style={{
            padding: 12, marginBottom: 14,
            border: "1px solid var(--rose)", borderRadius: 8,
            background: "var(--rose-soft)", color: "var(--rose)",
            fontSize: 13,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
          }}>
            <span>Couldn&apos;t load examples: {loadError}</span>
            <button className="btn btn-ghost" onClick={refetch}>Retry</button>
          </div>
        )}

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12, marginBottom: 20,
        }}>
          <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--paper-3)",
            borderRadius: 8, width: "fit-content" }}>
            {([
              ["good", `Good · ${counts.good}`],
              ["bad",  `Bad · ${counts.bad}`],
            ] as [ExampleKind, string][]).map(([id, label]) => (
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
          <button
            className="btn btn-primary"
            onClick={() => setModal({ kind: "upload", presetKind: tab })}
            disabled={byKind === null}
          >
            <Icon name="plus" size={14} /> Add example
          </button>
        </div>

        {byKind === null ? (
          <ExamplesGridSkeleton />
        ) : list.length === 0 ? (
          <div style={{
            padding: "48px 20px", borderRadius: "var(--radius-sm)",
            border: "1px dashed var(--rule-2)",
            background: "var(--paper-2)",
            textAlign: "center",
            color: "var(--ink-3)",
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink-2)", marginBottom: 4 }}>
              No {tab} examples uploaded yet.
            </div>
            <div style={{ fontSize: 13 }}>
              Click <strong style={{ color: "var(--ink-2)" }}>Add example</strong> to upload one.
            </div>
          </div>
        ) : (
          <ExamplesGrid
            kind={tab}
            list={list}
            activeMenuId={activeMenuId}
            onMenuToggle={(id) => setActiveMenuId((prev) => (prev === id ? null : id))}
            onMenuClose={() => setActiveMenuId(null)}
            onEdit={(ex) => { setActiveMenuId(null); setModal({ kind: "edit", example: ex }); }}
            onReplace={(ex) => { setActiveMenuId(null); setModal({ kind: "replace", example: ex }); }}
            onDelete={(ex) => { setActiveMenuId(null); setModal({ kind: "delete", example: ex }); }}
            onReorder={(next) => handleReorder(tab, next)}
          />
        )}
      </div>

      {modal.kind === "upload" && (
        <ExampleUploadModal
          presetKind={modal.presetKind}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={handleUpload}
        />
      )}
      {modal.kind === "edit" && (
        <ExampleEditModal
          example={modal.example}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={(patch) => handleEditMetadata(modal.example, patch)}
        />
      )}
      {modal.kind === "replace" && (
        <ExampleReplaceModal
          example={modal.example}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={(file) => handleReplace(modal.example, file)}
        />
      )}
      {modal.kind === "delete" && (
        <ExampleDeleteModal
          example={modal.example}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={() => handleDelete(modal.example)}
        />
      )}
    </>
  );
}

function ExamplesGrid({
  kind,
  list,
  activeMenuId,
  onMenuToggle,
  onMenuClose,
  onEdit,
  onReplace,
  onDelete,
  onReorder,
}: {
  kind: ExampleKind;
  list: Example[];
  activeMenuId: string | null;
  onMenuToggle: (id: string) => void;
  onMenuClose: () => void;
  onEdit: (ex: Example) => void;
  onReplace: (ex: Example) => void;
  onDelete: (ex: Example) => void;
  onReorder: (next: Example[]) => void;
}) {
  // Pointer sensor with a small activation distance so a click on the
  // dots-menu button doesn't accidentally start a drag. Keyboard sensor
  // (space to pick up, arrows to move, space to drop) is provided by
  // dnd-kit's default; we wire it explicitly so the activation feels right.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = list.findIndex((e) => e.id === active.id);
    const newIndex = list.findIndex((e) => e.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(list, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={list.map((e) => e.id)} strategy={rectSortingStrategy}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {list.map((ex) => (
            <SortableExampleCard
              key={ex.id}
              example={ex}
              kind={kind}
              menuOpen={activeMenuId === ex.id}
              onMenuToggle={() => onMenuToggle(ex.id)}
              onMenuClose={onMenuClose}
              onEdit={() => onEdit(ex)}
              onReplace={() => onReplace(ex)}
              onDelete={() => onDelete(ex)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableExampleCard({
  example,
  kind,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onEdit,
  onReplace,
  onDelete,
}: {
  example: Example;
  kind: ExampleKind;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onEdit: () => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: example.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 5 : "auto",
    cursor: isDragging ? "grabbing" : "grab",
  };

  // Stop the drag listeners from intercepting clicks on interactive
  // children (the dots menu, menu items). We attach listeners only to
  // the card frame, not the menu button.
  return (
    <div
      ref={setNodeRef}
      className="card"
      style={{ padding: 12, position: "relative", ...style }}
      {...attributes}
      {...listeners}
    >
      <div style={{
        aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
        position: "relative", marginBottom: 10,
        border: `2px solid var(--${kind === "good" ? "moss" : "rose"})`,
        background: "var(--paper-3)",
      }}>
        {example.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={example.imageUrl}
            alt={example.label}
            style={{
              width: "100%", height: "100%", objectFit: "cover",
              display: "block",
            }}
            draggable={false}
          />
        ) : (
          <div style={{
            width: "100%", height: "100%", display: "grid", placeItems: "center",
            color: "var(--ink-3)", fontSize: 11, fontFamily: "var(--font-mono)",
          }}>
            no image
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {example.label}
          </div>
          <div style={{
            fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 2,
          }}>
            #{example.displayOrder}
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 6px" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
            aria-label="Card actions"
          >
            <Icon name="dots" size={14} />
          </button>
          {menuOpen && (
            <CardMenu
              onClose={onMenuClose}
              onEdit={onEdit}
              onReplace={onReplace}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
      {example.note && (
        <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.4 }}>
          {example.note}
        </div>
      )}
    </div>
  );
}

function CardMenu({
  onClose,
  onEdit,
  onReplace,
  onDelete,
}: {
  onClose: () => void;
  onEdit: () => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  // Close on outside click. The wrapping <div> stops drag listeners but
  // we still want to dismiss the menu when clicking elsewhere on the page.
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items: { label: string; icon: string; tone?: "rose"; onClick: () => void }[] = [
    { label: "Edit metadata", icon: "tag",      onClick: onEdit },
    { label: "Replace image", icon: "image",    onClick: onReplace },
    { label: "Delete",        icon: "x",        tone: "rose", onClick: onDelete },
  ];

  return (
    <div
      ref={ref}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "calc(100% + 4px)", right: 0,
        minWidth: 160, zIndex: 20,
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        boxShadow: "var(--shadow-md, 0 6px 20px rgba(0,0,0,0.12))",
        padding: 4,
        display: "flex", flexDirection: "column",
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          onClick={it.onClick}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 6,
            background: "transparent",
            color: it.tone === "rose" ? "var(--rose)" : "var(--ink)",
            fontSize: 13, textAlign: "left", cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper-2)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon name={it.icon} size={13} />
          {it.label}
        </button>
      ))}
    </div>
  );
}

function ExamplesGridSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card" style={{ padding: 12, opacity: 0.5 }}>
          <div style={{
            aspectRatio: "3/2", borderRadius: 6, marginBottom: 10,
            background: "var(--paper-3)",
          }} />
          <div style={{ height: 14, width: "60%", background: "var(--paper-3)", borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 10, width: "40%", background: "var(--paper-3)", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

// ── modals ─────────────────────────────────────────────────────────────────
//
// Local Modal/Backdrop component. The one in ReviewScreen.tsx is module-
// private; reproducing the chrome here keeps the admin screen's state +
// styling self-contained.

function ExampleModalShell({
  title,
  eyebrow,
  tone,
  width = 520,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  tone: "moss" | "rose" | "sun" | "lake";
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const toneVar =
    tone === "moss" ? "var(--moss)" :
    tone === "rose" ? "var(--rose)" :
    tone === "sun"  ? "var(--sun)"  : "var(--lake)";
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(20, 25, 30, 0.55)",
        backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width,
          background: "var(--paper)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: 24,
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: toneVar, marginBottom: 4,
          }}>{eyebrow}</div>
          <h2 style={{
            fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
            letterSpacing: "-0.02em", margin: 0,
          }}>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

// Bytes → human-readable. Nothing fancy; just enough to make the size
// limit message read naturally.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ExampleFilePicker({
  file,
  previewUrl,
  onChange,
  fileError,
  helperText,
}: {
  file: File | null;
  previewUrl: string | null;
  onChange: (file: File | null, error: string | null) => void;
  fileError: string | null;
  helperText?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handlePick = (picked: File | null) => {
    if (!picked) {
      onChange(null, null);
      return;
    }
    if (!picked.type.startsWith("image/")) {
      onChange(null, "Pick an image file (PNG, JPG, GIF, WebP).");
      return;
    }
    if (picked.size > MAX_EXAMPLE_FILE_BYTES) {
      onChange(null, `That file is ${formatBytes(picked.size)} — the max is 10 MB.`);
      return;
    }
    onChange(picked, null);
  };

  return (
    <div>
      <label className="label" style={{ marginBottom: 6 }}>Image</label>
      <div style={{
        display: "flex", gap: 12, alignItems: "stretch",
        padding: 12,
        border: `1px ${fileError ? "solid var(--rose)" : "dashed var(--rule-2)"}`,
        borderRadius: 8,
        background: "var(--paper-2)",
      }}>
        <div style={{
          width: 110, aspectRatio: "3/2",
          borderRadius: 6, overflow: "hidden",
          background: "var(--paper-3)",
          display: "grid", placeItems: "center",
          color: "var(--ink-3)", fontSize: 11, fontFamily: "var(--font-mono)",
          flexShrink: 0,
        }}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : "no image"}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
              {file ? file.name : "Choose a file to upload"}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              {file ? formatBytes(file.size) : (helperText ?? "PNG · JPG · GIF · WebP — 10 MB max")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => inputRef.current?.click()}
              style={{ fontSize: 12 }}
            >
              {file ? "Choose different file" : "Choose file"}
            </button>
            {file && (
              <button
                className="btn btn-ghost"
                type="button"
                style={{ fontSize: 12, color: "var(--ink-3)" }}
                onClick={() => handlePick(null)}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
        />
      </div>
      {fileError && (
        <div style={{ fontSize: 12, color: "var(--rose)", marginTop: 6 }}>{fileError}</div>
      )}
    </div>
  );
}

function ExampleUploadModal({
  presetKind,
  onCancel,
  onConfirm,
}: {
  presetKind: ExampleKind;
  onCancel: () => void;
  onConfirm: (kind: ExampleKind, label: string, note: string, file: File) => Promise<void>;
}) {
  const [kind, setKind] = React.useState<ExampleKind>(presetKind);
  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Generate (and revoke on change) an object URL so the picker shows a
  // preview without uploading anything yet.
  const previewUrl = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const canSubmit = !!file && label.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    try {
      await onConfirm(kind, label.trim(), note.trim(), file);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ExampleModalShell
      eyebrow={`New ${kind} example`}
      title="Upload an example"
      tone={kind === "good" ? "moss" : "rose"}
      onClose={onCancel}
      width={560}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FieldRow label="Type">
          <KindToggle value={kind} onChange={setKind} />
        </FieldRow>
        <ExampleFilePicker
          file={file}
          previewUrl={previewUrl}
          fileError={fileError}
          onChange={(f, err) => { setFile(f); setFileError(err); }}
        />
        <FieldRow label="Label" hint="Short title shown under the image.">
          <input className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={48}
            placeholder="e.g. Hero shot" />
        </FieldRow>
        <FieldRow label="Note" hint="Optional — explains the why for reviewers.">
          <textarea className="textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={240} />
        </FieldRow>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
          onClick={submit}
        >
          <Icon name="check" size={12} /> {submitting ? "Uploading…" : "Upload"}
        </button>
      </div>
    </ExampleModalShell>
  );
}

function ExampleEditModal({
  example,
  onCancel,
  onConfirm,
}: {
  example: Example;
  onCancel: () => void;
  onConfirm: (patch: { label: string; note: string; kind: ExampleKind }) => Promise<void>;
}) {
  const [label, setLabel] = React.useState(example.label);
  const [note, setNote] = React.useState(example.note);
  const [kind, setKind] = React.useState<ExampleKind>(example.kind);
  const [submitting, setSubmitting] = React.useState(false);

  const dirty =
    label.trim() !== example.label ||
    note.trim()  !== example.note  ||
    kind         !== example.kind;
  const canSubmit = dirty && label.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm({ label: label.trim(), note: note.trim(), kind });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ExampleModalShell
      eyebrow="Edit example"
      title={example.label}
      tone={kind === "good" ? "moss" : "rose"}
      onClose={onCancel}
      width={520}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FieldRow label="Type">
          <KindToggle value={kind} onChange={setKind} />
        </FieldRow>
        <FieldRow label="Label">
          <input className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={48} />
        </FieldRow>
        <FieldRow label="Note">
          <textarea className="textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={240} />
        </FieldRow>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
          To change the image, close this and use &ldquo;Replace image&rdquo; from the card menu.
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
          onClick={submit}
        >
          <Icon name="check" size={12} /> {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </ExampleModalShell>
  );
}

function ExampleReplaceModal({
  example,
  onCancel,
  onConfirm,
}: {
  example: Example;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const previewUrl = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const canSubmit = !!file && !submitting;
  const submit = async () => {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    try {
      await onConfirm(file);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ExampleModalShell
      eyebrow="Replace image"
      title={example.label}
      tone="lake"
      onClose={onCancel}
      width={560}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "stretch", marginBottom: 14 }}>
        <div style={{
          width: 140, aspectRatio: "3/2", borderRadius: 6, overflow: "hidden",
          border: "1px solid var(--rule)", background: "var(--paper-3)",
          flexShrink: 0,
        }}>
          {example.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={example.imageUrl} alt="Current"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
          <div className="card-eyebrow">Current image</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Pick a new image to replace it. The old file is removed from storage after the new one uploads.
          </div>
        </div>
      </div>
      <ExampleFilePicker
        file={file}
        previewUrl={previewUrl}
        fileError={fileError}
        onChange={(f, err) => { setFile(f); setFileError(err); }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
          onClick={submit}
        >
          <Icon name="check" size={12} /> {submitting ? "Replacing…" : "Replace image"}
        </button>
      </div>
    </ExampleModalShell>
  );
}

function ExampleDeleteModal({
  example,
  onCancel,
  onConfirm,
}: {
  example: Example;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = React.useState(false);

  return (
    <ExampleModalShell
      eyebrow="Delete example"
      title={`Delete "${example.label}"?`}
      tone="rose"
      onClose={onCancel}
      width={460}
    >
      <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 0, marginBottom: 18 }}>
        This removes the row from the library and deletes the image from storage. Reviewers stop seeing it on their next page load. There&apos;s no undo.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-primary"
          style={{ background: "var(--rose)" }}
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            try { await onConfirm(); } finally { setSubmitting(false); }
          }}
        >
          <Icon name="x" size={12} /> {submitting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </ExampleModalShell>
  );
}

function KindToggle({
  value,
  onChange,
}: {
  value: ExampleKind;
  onChange: (kind: ExampleKind) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {([
        ["good", "Good · approve example", "var(--moss)", "var(--moss-soft)"],
        ["bad",  "Bad · flag example",     "var(--rose)", "var(--rose-soft)"],
      ] as [ExampleKind, string, string, string][]).map(([id, label, color, soft]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            style={{
              padding: "10px 12px", borderRadius: 8,
              border: on ? `1.5px solid ${color}` : "1px solid var(--rule)",
              background: on ? soft : "var(--paper)",
              color: on ? color : "var(--ink-2)",
              textAlign: "left", cursor: "pointer",
              fontSize: 13, fontWeight: on ? 500 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function AdminOverview({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const { id: currentUserId } = useCurrentUser();
  const [roster, setRoster] = React.useState<ReviewerStats[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<ReviewerStats | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchReviewerRoster(supabase)
      .then((rows) => { if (!cancelled) setRoster(rows); })
      .catch((err) => {
        console.error("[admin-overview] fetchReviewerRoster failed:", err);
        if (!cancelled) {
          setLoadError(err?.message ?? "Failed to load reviewer roster");
          setRoster([]);
        }
      });
    return () => { cancelled = true; };
  }, [supabase]);

  // Persist a role/team edit. Optimistic UI: patch the local roster row
  // first, roll back on failure. The roster comes from the `reviewer_stats`
  // view but the write goes to the `profiles` base table; the next fetch
  // will resync.
  const saveEdit = async (
    user: ReviewerStats,
    patch: { role: Role; team: string },
  ): Promise<boolean> => {
    const previous = roster;
    const trimmedTeam = patch.team.trim();
    const nextTeam = trimmedTeam.length === 0 ? null : trimmedTeam;
    setRoster((prev) => prev?.map((r) =>
      r.id === user.id ? { ...r, role: patch.role, team: nextTeam } : r,
    ) ?? prev);
    try {
      await updateReviewerProfile(supabase, user.id, {
        role: patch.role,
        team: patch.team,
      });
      toast.show?.(`Updated ${user.fullName ?? user.email.split("@")[0]}.`, "check");
      return true;
    } catch (err: any) {
      console.error("[admin-overview] update failed:", err);
      setRoster(previous ?? null);
      toast.show?.(err?.message ? `Couldn't save: ${err.message}` : "Couldn't save changes.");
      return false;
    }
  };

  const all = roster ?? [];
  const accountCount = all.length;

  // "Active in last 24h" = reviewed something within 24h. last_active_at on
  // profiles bumps on every review insert (trigger 4) so it's the cleanest
  // signal here. The first column ("Reviewed today") aggregates the live
  // reviewed_today value across all rows.
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const activeLast24h = all.filter((r) => {
    const t = Date.parse(r.lastActiveAt);
    return Number.isFinite(t) && now - t <= dayMs;
  }).length;
  const reviewedToday = all.reduce((sum, r) => sum + r.reviewedToday, 0);

  // Case-insensitive match across name/email/team. Empty search = show all.
  const q = search.trim().toLowerCase();
  const visible = q
    ? all.filter((r) =>
        (r.fullName ?? "").toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.team ?? "").toLowerCase().includes(q),
      )
    : all;

  const subtitle = roster === null
    ? "Loading roster…"
    : `${accountCount} account${accountCount === 1 ? "" : "s"} · ${activeLast24h} active in last 24h`;

  return (
    <>
      <PageHeader
        eyebrow="Admin · Overview"
        title="<em>Reviewers.</em>"
        sub={subtitle}
      >
        <div style={{ position: "relative" }}>
          <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
          <input
            className="input"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30, width: 220 }}
          />
        </div>
        <button className="btn btn-primary"><Icon name="plus" size={14} /> Invite</button>
      </PageHeader>

      <div className="page-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 20 }}>
          {([
            ["Reviewed today",
              roster === null ? "—" : reviewedToday.toLocaleString(),
              reviewedToday === 1 ? "photo" : "photos"],
            ["Active reviewers",
              roster === null ? "—" : activeLast24h.toLocaleString(),
              accountCount > 0 ? `/ ${accountCount}` : ""],
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

        {loadError && (
          <div style={{
            padding: 12, marginBottom: 14,
            border: "1px solid var(--rose)", borderRadius: 8,
            background: "var(--rose-soft)", color: "var(--rose)",
            fontSize: 13,
          }}>
            Couldn&apos;t load roster: {loadError}
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Team</th>
                <th style={{ width: 110 }}>Reviewed</th>
                <th style={{ width: 110, textAlign: "right" }}>Points</th>
                <th style={{ width: 110 }}>Last active</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {roster === null && <RosterSkeletonRows />}
              {roster !== null && visible.length === 0 && (
                <tr>
                  <td colSpan={7} style={{
                    textAlign: "center", padding: "24px 12px",
                    color: "var(--ink-3)", fontSize: 13,
                  }}>
                    {q
                      ? <>No reviewers match &ldquo;{search}&rdquo;.</>
                      : "No reviewer accounts yet."}
                  </td>
                </tr>
              )}
              {visible.map(u => (
                <ReviewerRow
                  key={u.id}
                  user={u}
                  onEdit={() => setEditing(u)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ReviewerEditModal
          user={editing}
          isSelf={!!currentUserId && currentUserId === editing.id}
          onCancel={() => setEditing(null)}
          onConfirm={async (patch) => {
            const ok = await saveEdit(editing, patch);
            if (ok) setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ReviewerRow({ user, onEdit }: { user: ReviewerStats; onEdit: () => void }) {
  const displayName = user.fullName ?? user.email.split("@")[0];
  const initials = (() => {
    if (user.fullName) {
      const parts = user.fullName.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    }
    const local = user.email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "··";
  })();
  const rolePillClass = user.role === "admin"  ? "pill pill-sun"
                      : user.role === "senior" ? "pill pill-lake"
                      : "pill";

  return (
    <tr>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
            {initials}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{displayName}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{user.email}</div>
          </div>
        </div>
      </td>
      <td>
        <span className={rolePillClass}>{ROLE_LABEL[user.role]}</span>
      </td>
      <td style={{ fontSize: 13 }}>{user.team || "—"}</td>
      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
        {user.totalReviews.toLocaleString()}
      </td>
      <td style={{
        textAlign: "right",
        fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500,
      }}>
        {user.totalPoints.toLocaleString()}
      </td>
      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
        {formatLastActive(user.lastActiveAt)}
      </td>
      <td>
        <button
          className="btn btn-ghost"
          style={{ padding: "4px 6px" }}
          onClick={onEdit}
          title="Edit reviewer"
          aria-label={`Edit ${displayName}`}
        >
          <Icon name="dots" size={14} />
        </button>
      </td>
    </tr>
  );
}

function ReviewerEditModal({
  user,
  isSelf,
  onCancel,
  onConfirm,
}: {
  user: ReviewerStats;
  isSelf: boolean;
  onCancel: () => void;
  onConfirm: (patch: { role: Role; team: string }) => Promise<void>;
}) {
  const [role, setRole] = React.useState<Role>(user.role);
  const [team, setTeam] = React.useState(user.team ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  // Lockout protection: don't let the only-or-current admin demote
  // themselves and lose access in the same click. They can still change
  // team. This is the cheapest version of the guard — counting other
  // admins to allow demotion when there's a peer is doable, but the
  // recovery story (edit profiles in SQL) is fine for now.
  const wouldLockOutSelf = isSelf && user.role === "admin" && role !== "admin";

  const dirty = role !== user.role || team.trim() !== (user.team ?? "");
  const canSave = dirty && !submitting && !wouldLockOutSelf;

  const submit = async () => {
    if (!canSave) return;
    setSubmitting(true);
    try {
      await onConfirm({ role, team });
    } finally {
      setSubmitting(false);
    }
  };

  const displayName = user.fullName ?? user.email.split("@")[0];

  return (
    <ExampleModalShell
      eyebrow={isSelf ? "Edit your account" : "Edit reviewer"}
      title={displayName}
      tone="lake"
      onClose={onCancel}
      width={500}
    >
      <div style={{
        marginTop: -8, marginBottom: 18,
        fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)",
      }}>
        {user.email}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <FieldRow
          label="Role"
          hint={isSelf
            ? "You can't demote yourself out of the admin role from here. Change another admin first if you need to."
            : undefined}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {([
              ["reviewer", ROLE_LABEL.reviewer, "Reviews the queue."],
              ["senior",   ROLE_LABEL.senior,   "Plus resolves flags."],
              ["admin",    ROLE_LABEL.admin,    "Plus admin section."],
            ] as [Role, string, string][]).map(([id, label, hint]) => {
              const on = role === id;
              const disabled = isSelf && user.role === "admin" && id !== "admin";
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => !disabled && setRole(id)}
                  disabled={disabled}
                  style={{
                    padding: "10px 12px", borderRadius: 8,
                    border: on ? "1.5px solid var(--lake)" : "1px solid var(--rule)",
                    background: on ? "var(--lake-soft)" : "var(--paper)",
                    color: on ? "var(--ink)" : "var(--ink-2)",
                    textAlign: "left",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: on ? 500 : 400, marginBottom: 2 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{hint}</div>
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow label="Team" hint="Free text — Operations, Programs, Marketing, Support, etc.">
          <input
            className="input"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            placeholder="—"
            maxLength={48}
          />
        </FieldRow>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!canSave}
          style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
          onClick={submit}
        >
          <Icon name="check" size={12} /> {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </ExampleModalShell>
  );
}

function RosterSkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} style={{ opacity: 0.4 }}>
          <td>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, background: "var(--paper-3)" }} />
              <div>
                <div style={{ height: 12, width: 120, background: "var(--paper-3)", borderRadius: 4, marginBottom: 4 }} />
                <div style={{ height: 10, width: 160, background: "var(--paper-3)", borderRadius: 4 }} />
              </div>
            </div>
          </td>
          <td><div style={{ height: 18, width: 80, background: "var(--paper-3)", borderRadius: 999 }} /></td>
          <td><div style={{ height: 12, width: 70, background: "var(--paper-3)", borderRadius: 4 }} /></td>
          <td><div style={{ height: 12, width: 30, background: "var(--paper-3)", borderRadius: 4 }} /></td>
          <td style={{ textAlign: "right" }}><div style={{ height: 16, width: 50, background: "var(--paper-3)", borderRadius: 4, marginLeft: "auto" }} /></td>
          <td><div style={{ height: 12, width: 60, background: "var(--paper-3)", borderRadius: 4 }} /></td>
          <td />
        </tr>
      ))}
    </>
  );
}

function formatLastActive(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60)  return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)  return `${min}m ago`;
  const hr  = Math.round(min / 60);
  if (hr  < 24)  return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30)  return `${day}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
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

// Debounced text input that mirrors a settings field. Renders on every
// keystroke (instant feedback), but only calls onCommit after the user
// stops typing for `delay` ms, plus immediately on blur. Without this,
// every keystroke would punch through to a Supabase round-trip — fine
// for prototyping in localStorage, painfully chatty against a real DB.
function DebouncedTextInput({
  value,
  onCommit,
  delay = 500,
  className,
  type = "text",
  maxLength,
  style,
  transform,
}: {
  value: string;
  onCommit: (next: string) => void;
  delay?: number;
  className?: string;
  type?: string;
  maxLength?: number;
  style?: React.CSSProperties;
  transform?: (raw: string) => string;
}) {
  const [draft, setDraft] = React.useState(value);
  // Keep draft in sync if the canonical settings value changes from elsewhere
  // (e.g. a different tab, or an optimistic rollback after a save error).
  React.useEffect(() => { setDraft(value); }, [value]);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = React.useCallback((next: string) => {
    if (next !== value) onCommit(next);
  }, [value, onCommit]);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <input
      type={type}
      className={className}
      maxLength={maxLength}
      style={style}
      value={draft}
      onChange={(e) => {
        const next = transform ? transform(e.target.value) : e.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(next), delay);
      }}
      onBlur={() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        flush(draft);
      }}
    />
  );
}

export function AdminSettings() {
  const { settings, hydrated, update, reset, saveError } = useSettings();
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
        sub={hydrated
          ? "Branding and reviewer copy. Changes save to the database automatically."
          : "Loading current settings from the database…"}
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

      {saveError && (
        <div className="page-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div style={{
            padding: 12, marginBottom: 14,
            border: "1px solid var(--rose)", borderRadius: 8,
            background: "var(--rose-soft)", color: "var(--rose)",
            fontSize: 13,
          }}>
            Couldn&apos;t save: {saveError}
          </div>
        </div>
      )}

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 4 }}>Branding</h3>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Shown in the sidebar and in browser tab.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 14 }}>
              <FieldRow label="App name">
                <DebouncedTextInput className="input"
                  value={settings.brandName}
                  onCommit={(v) => set("brandName", v)}
                  maxLength={32} />
              </FieldRow>
              <FieldRow label="Tagline">
                <DebouncedTextInput className="input"
                  value={settings.brandTagline}
                  onCommit={(v) => set("brandTagline", v)}
                  maxLength={48} />
              </FieldRow>
              <FieldRow label="Mark" hint="1 char">
                <DebouncedTextInput className="input"
                  style={{ textAlign: "center", fontFamily: "var(--font-display)", fontSize: 20 }}
                  value={settings.brandMark}
                  onCommit={(v) => set("brandMark", v)}
                  transform={(raw) => raw.slice(0, 2)}
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
                <DebouncedTextInput className="input"
                  value={settings.homeGreeting}
                  onCommit={(v) => set("homeGreeting", v)}
                  maxLength={120} />
              </FieldRow>
              <FieldRow label="Home subtitle">
                <DebouncedTextInput className="input"
                  value={settings.homeSubtitle}
                  onCommit={(v) => set("homeSubtitle", v)}
                  maxLength={160} />
              </FieldRow>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Completion + empty states</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
                <FieldRow label="Completion pennant" hint="Shown above the points total.">
                  <DebouncedTextInput className="input"
                    value={settings.completionTitle}
                    onCommit={(v) => set("completionTitle", v)}
                    maxLength={40} />
                </FieldRow>
                <FieldRow label="Completion message">
                  <DebouncedTextInput className="input"
                    value={settings.completionMessage}
                    onCommit={(v) => set("completionMessage", v)}
                    maxLength={120} />
                </FieldRow>
              </div>
              <FieldRow label="Empty queue message" hint="Shown when there are no photos waiting.">
                <DebouncedTextInput className="input"
                  value={settings.emptyQueueMessage}
                  onCommit={(v) => set("emptyQueueMessage", v)}
                  maxLength={160} />
              </FieldRow>
              <FieldRow label="Support email" hint="Where reviewers go for help.">
                <DebouncedTextInput className="input" type="email"
                  value={settings.supportEmail}
                  onCommit={(v) => set("supportEmail", v)} />
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
              Settings live on the <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--paper)", padding: "1px 4px", borderRadius: 3 }}>app_settings</code> table in Supabase. Edits here are seen by every reviewer on their next page load.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
