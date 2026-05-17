"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  DOW_LABELS,
  fetchTriageConfig,
  resetAllSampleFlags,
  updateTriageConfig,
  type TriageConfig,
} from "@/lib/triage-config";

export function AdminTriageSettings({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [config, setConfig] = React.useState<TriageConfig | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    firstWeekWindowStart: "",
    firstWeekWindowEnd: "",
    maxForTriagePerBurst: 200,
    sampleBurstDow: 2,
    sampleBurstHour: 19,
    claimExpiryMinutes: 60,
  });

  React.useEffect(() => {
    let cancelled = false;
    fetchTriageConfig(supabase)
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setForm({
          firstWeekWindowStart: c.firstWeekWindowStart,
          firstWeekWindowEnd: c.firstWeekWindowEnd,
          maxForTriagePerBurst: c.maxForTriagePerBurst,
          sampleBurstDow: c.sampleBurstDow,
          sampleBurstHour: c.sampleBurstHour,
          claimExpiryMinutes: c.claimExpiryMinutes,
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message ?? "Failed to load triage config");
      });
    return () => { cancelled = true; };
  }, [supabase]);

  const save = async () => {
    setBusy(true);
    try {
      const next = await updateTriageConfig(supabase, form);
      setConfig(next);
      toast.show("Triage settings saved", "check");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.show(msg, "x");
    } finally {
      setBusy(false);
    }
  };

  const resetSamples = async () => {
    if (!confirm("Reset sampled_for_burst on all pending/in-progress photos?")) return;
    setBusy(true);
    try {
      const count = await resetAllSampleFlags(supabase);
      toast.show(`Reset sample flags on ${count} photo(s)`, "ok");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reset failed";
      toast.show(msg, "x");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Triage"
        title="<em>Yearly</em> triage setup."
        sub="1st-week window, Tuesday sample burst, and claim expiry."
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {loadError && <ErrorBox message={loadError} />}
        {config === null && !loadError && (
          <div className="card" style={{ color: "var(--ink-3)" }}>Loading…</div>
        )}
        {config !== null && (
          <>
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>1st-week window</h3>
              <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
                Camp weeks whose starts_on falls in this range compete for first_week
                per location (earliest wins). Override per week on Locations notes.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <Field label="Window start">
                  <input
                    type="date"
                    className="input"
                    value={form.firstWeekWindowStart}
                    onChange={(e) => setForm((f) => ({ ...f, firstWeekWindowStart: e.target.value }))}
                  />
                </Field>
                <Field label="Window end">
                  <input
                    type="date"
                    className="input"
                    value={form.firstWeekWindowEnd}
                    onChange={(e) => setForm((f) => ({ ...f, firstWeekWindowEnd: e.target.value }))}
                  />
                </Field>
              </div>
            </div>

            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Tuesday sample burst</h3>
              <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
                Vercel cron runs at Tuesday 19:00 UTC. The scheduled handler no-ops unless
                the current UTC day/hour matches these values.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                <Field label="Day of week (UTC)">
                  <select
                    className="input"
                    value={form.sampleBurstDow}
                    onChange={(e) => setForm((f) => ({ ...f, sampleBurstDow: Number(e.target.value) }))}
                  >
                    {DOW_LABELS.map((label, i) => (
                      <option key={label} value={i}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Hour (UTC)">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className="input"
                    value={form.sampleBurstHour}
                    onChange={(e) => setForm((f) => ({ ...f, sampleBurstHour: Number(e.target.value) }))}
                  />
                </Field>
                <Field label="Max photos per burst">
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={form.maxForTriagePerBurst}
                    onChange={(e) => setForm((f) => ({ ...f, maxForTriagePerBurst: Number(e.target.value) }))}
                  />
                </Field>
              </div>
            </div>

            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 8 }}>Claims</h3>
              <Field label="Claim expiry (minutes)">
                <input
                  type="number"
                  min={1}
                  className="input"
                  style={{ maxWidth: 160 }}
                  value={form.claimExpiryMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, claimExpiryMinutes: Number(e.target.value) }))}
                />
              </Field>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                <Icon name="check" size={12} /> Save settings
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetSamples} disabled={busy}>
                Reset all sample flags
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" style={{ marginBottom: 4, display: "block" }}>{label}</label>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      padding: 10,
      border: "1px solid var(--rose)",
      borderRadius: 6,
      background: "var(--rose-soft)",
      color: "var(--rose)",
      fontSize: 12,
    }}>
      {message}
    </div>
  );
}
