"use client";

import React from "react";
import { PageHeader, type ToastApi } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import {
  fetchLocationsForAdmin,
  updateEvergreenNotes,
  updateFirstWeekOverride,
  type FirstWeekOverrideValue,
  type LocationWithWeeks,
} from "@/lib/triage-admin";

export function AdminLocationsNotes({ toast }: { toast: ToastApi }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [locations, setLocations] = React.useState<LocationWithWeeks[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [draftNotes, setDraftNotes] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    fetchLocationsForAdmin(supabase)
      .then((rows) => {
        if (cancelled) return;
        setLocations(rows);
        const notes: Record<string, string> = {};
        for (const loc of rows) notes[loc.id] = loc.evergreenNotes ?? "";
        setDraftNotes(notes);
        if (rows.length > 0) setExpandedId(rows[0].id);
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
      toast.show("Evergreen notes saved", "check");
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Save failed", "x");
    } finally {
      setBusyId(null);
    }
  };

  const setOverride = async (campWeekId: string, value: FirstWeekOverrideValue) => {
    setBusyId(campWeekId);
    try {
      await updateFirstWeekOverride(supabase, campWeekId, value);
      setLocations((prev) =>
        (prev ?? []).map((loc) => ({
          ...loc,
          weeks: loc.weeks.map((w) =>
            w.id === campWeekId ? { ...w, isFirstWeekOverride: value } : w,
          ),
        })),
      );
      toast.show("Week override updated", "check");
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : "Update failed", "x");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin · Locations"
        title="Evergreen <em>notes</em>."
        sub="Reviewer-visible sidebar copy per location, plus 1st-week overrides."
      />
      <div className="page-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {loadError && (
          <div className="card" style={{ color: "var(--rose)", fontSize: 12 }}>{loadError}</div>
        )}
        {locations === null && !loadError && (
          <div className="card" style={{ color: "var(--ink-3)" }}>Loading locations…</div>
        )}
        {(locations ?? []).map((loc) => (
          <div key={loc.id} className="card">
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === loc.id ? null : loc.id)}
              style={{
                width: "100%", textAlign: "left", background: "none", border: "none",
                cursor: "pointer", padding: 0, marginBottom: expandedId === loc.id ? 12 : 0,
              }}
            >
              <h3 className="card-title">{loc.name}</h3>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {loc.weeks.length} camp week{loc.weeks.length === 1 ? "" : "s"}
              </div>
            </button>

            {expandedId === loc.id && (
              <>
                <label className="label" style={{ display: "block", marginBottom: 6 }}>
                  Evergreen notes (shown in triage grid sidebar)
                </label>
                <textarea
                  className="input"
                  rows={4}
                  value={draftNotes[loc.id] ?? ""}
                  onChange={(e) =>
                    setDraftNotes((d) => ({ ...d, [loc.id]: e.target.value }))
                  }
                  placeholder="e.g. Watch for loose cables near the main lab door…"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ marginTop: 8, marginBottom: 16 }}
                  disabled={busyId === loc.id}
                  onClick={() => saveNotes(loc.id)}
                >
                  Save notes
                </button>

                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Camp weeks</div>
                <table className="table" style={{ width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>Starts</th>
                      <th>Role</th>
                      <th>1st-week override</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loc.weeks.map((w) => (
                      <tr key={w.id}>
                        <td>{w.name}</td>
                        <td>{w.startsOn}</td>
                        <td><code>{w.triageRole}</code></td>
                        <td>
                          <select
                            className="input"
                            style={{ fontSize: 12, padding: "4px 8px" }}
                            disabled={busyId === w.id}
                            value={
                              w.isFirstWeekOverride === null
                                ? "auto"
                                : w.isFirstWeekOverride
                                  ? "force"
                                  : "none"
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              const mapped: FirstWeekOverrideValue =
                                v === "auto" ? null : v === "force";
                              void setOverride(w.id, mapped);
                            }}
                          >
                            <option value="auto">Auto (window)</option>
                            <option value="force">Force 1st week</option>
                            <option value="none">Force not triaged</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
