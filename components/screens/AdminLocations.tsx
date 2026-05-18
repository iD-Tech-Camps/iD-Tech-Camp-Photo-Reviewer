"use client";

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  fetchLocationsForAdmin,
  updateEvergreenNotes,
  type AdminLocation,
} from "@/lib/triage-admin";
import { fetchTriageConfig, type TriageConfig } from "@/lib/triage-config";

export function AdminLocationsNotes({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [locations, setLocations] = React.useState<AdminLocation[] | null>(null);
  const [config, setConfig] = React.useState<TriageConfig | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [draftNotes, setDraftNotes] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLocationsForAdmin(supabase), fetchTriageConfig(supabase)])
      .then(([rows, cfg]) => {
        if (cancelled) return;
        setLocations(rows);
        setConfig(cfg);
        const notes: Record<string, string> = {};
        for (const loc of rows) notes[loc.id] = loc.evergreenNotes ?? "";
        setDraftNotes(notes);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err?.message ?? "Failed to load locations");
      });
    return () => { cancelled = true; };
  }, [supabase]);

  const saveNotes = async (locationId: string) => {
    setBusyId(locationId);
    try {
      const text = draftNotes[locationId] ?? "";
      await updateEvergreenNotes(supabase, locationId, text);
      setLocations((prev) =>
        (prev ?? []).map((l) =>
          l.id === locationId ? { ...l, evergreenNotes: text.trim() || null } : l,
        ),
      );
      toast.show("Notes saved", "check");
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Save failed", "x");
    } finally {
      setBusyId(null);
    }
  };

  // Partition by whether the location has any camp week starting inside
  // the admin's season window (triage_config.season_first_week_start →
  // season_last_week_start, both inclusive, matching the DB function).
  const { active, inactive } = React.useMemo(() => {
    if (!locations || !config) {
      return { active: [] as AdminLocation[], inactive: [] as AdminLocation[] };
    }
    const start = config.seasonFirstWeekStart;
    const end = config.seasonLastWeekStart;
    const a: AdminLocation[] = [];
    const i: AdminLocation[] = [];
    for (const loc of locations) {
      const hasWeekInSeason = loc.weekStarts.some((d) => d >= start && d <= end);
      (hasWeekInSeason ? a : i).push(loc);
    }
    return { active: a, inactive: i };
  }, [locations, config]);

  const countWeeksInSeason = (loc: AdminLocation): number => {
    if (!config) return 0;
    return loc.weekStarts.filter(
      (d) => d >= config.seasonFirstWeekStart && d <= config.seasonLastWeekStart,
    ).length;
  };

  const renderCard = (loc: AdminLocation, isActive: boolean) => {
    const isExpanded = expandedId === loc.id;
    const weeksInSeason = countWeeksInSeason(loc);
    const subtitle = isActive
      ? `${weeksInSeason} week${weeksInSeason === 1 ? "" : "s"} in season`
      : loc.weekStarts.length === 0
        ? "No camp weeks on record"
        : `${loc.weekStarts.length} total week${loc.weekStarts.length === 1 ? "" : "s"} · none in season`;
    return (
      <div key={loc.id} className="card">
        <button
          type="button"
          onClick={() => setExpandedId(isExpanded ? null : loc.id)}
          style={{
            width: "100%", textAlign: "left", background: "none", border: "none",
            cursor: "pointer", padding: 0, marginBottom: isExpanded ? 12 : 0,
          }}
        >
          <h3 className="card-title">{loc.name}</h3>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {subtitle}
            {loc.evergreenNotes ? " · has notes" : ""}
          </div>
        </button>

        {isExpanded && (
          <>
            <label className="label" style={{ display: "block", marginBottom: 6 }}>
              Evergreen notes (shown in triage grid sidebar)
            </label>
            <textarea
              className="input"
              rows={4}
              value={draftNotes[loc.id] ?? ""}
              onChange={(e) => setDraftNotes((d) => ({ ...d, [loc.id]: e.target.value }))}
              placeholder="e.g. Watch for loose cables near the main lab door…"
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 8 }}
              disabled={busyId === loc.id}
              onClick={() => void saveNotes(loc.id)}
            >
              Save notes
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Locations"
        title="Evergreen <em>notes</em>"
        sub={
          config
            ? `Season: ${config.seasonFirstWeekStart} → ${config.seasonLastWeekStart}`
            : "Reviewer-visible sidebar copy per location"
        }
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {loadError && (
          <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{loadError}</div>
        )}
        {locations === null && !loadError && (
          <div className="card" style={{ color: "var(--ink-3)" }}>Loading locations…</div>
        )}

        {locations !== null && (
          <>
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="page-eyebrow" style={{ margin: 0 }}>
                Active locations ({active.length})
              </h2>
              {active.length === 0 ? (
                <div className="card" style={{ color: "var(--ink-3)" }}>
                  No locations have weeks in the current season.
                </div>
              ) : (
                active.map((loc) => renderCard(loc, true))
              )}
            </section>

            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="page-eyebrow" style={{ margin: 0 }}>
                Inactive locations ({inactive.length})
              </h2>
              {inactive.length === 0 ? (
                <div className="card" style={{ color: "var(--ink-3)" }}>
                  Every known location has weeks in the current season.
                </div>
              ) : (
                inactive.map((loc) => renderCard(loc, false))
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
