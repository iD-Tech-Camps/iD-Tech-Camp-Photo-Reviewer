"use client";

import React from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import { fetchSelfPointsTotal } from "@/lib/points";

// Shared points cache. Hosts the reviewer's all-time total + event count and
// the cached `points_rules.points` value for 'triage_event'. The submit path
// in components/screens/Triage.tsx calls `bumpAfterTriageEvent()` on a
// successful clean/flag insert so the chip + My Stats headline tick up
// immediately. The next focus or route entry reconciles against the
// server (`refresh()`).

export type PointsSourceKind = "triage_event" | "photo_rating_event";

export type ReviewBumpResult = {
  earned: number;
  newTotal: number;
  newEventCount: number;
};

type PointsState = {
  total: number | null;
  eventCount: number | null;
  rulePointsBySource: Partial<Record<PointsSourceKind, number>>;
};

type PointsContextValue = PointsState & {
  loading: boolean;
  refresh: () => Promise<void>;
  bumpAfterReviewEvent: (source?: PointsSourceKind) => ReviewBumpResult | null;
  /** @deprecated Use bumpAfterReviewEvent */
  bumpAfterTriageEvent: () => void;
};

const FALLBACK: PointsContextValue = {
  total: null,
  eventCount: null,
  rulePointsBySource: {},
  loading: true,
  refresh: async () => {},
  bumpAfterReviewEvent: () => null,
  bumpAfterTriageEvent: () => {},
};

const PointsContext = React.createContext<PointsContextValue>(FALLBACK);

export function PointsProvider({ children }: { children: React.ReactNode }) {
  const { id: userId } = useCurrentUser();
  const supabase = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<PointsState>({
    total: null,
    eventCount: null,
    rulePointsBySource: {},
  });
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!userId) {
      setState({ total: null, eventCount: null, rulePointsBySource: {} });
      setLoading(false);
      return;
    }
    try {
      const row = await fetchSelfPointsTotal(supabase, userId);
      setState((s) => ({
        ...s,
        total: row?.totalPoints ?? 0,
        eventCount: row?.eventCount ?? 0,
      }));
    } catch (err: unknown) {
      console.warn(
        "[points] refresh failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      setLoading(false);
    }
  }, [supabase, userId]);

  // Initial load: rule (once) + totals. Re-running on userId change handles
  // sign-in/sign-out without a full reload.
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const rulePromise = (async (): Promise<Partial<Record<PointsSourceKind, number>> | null> => {
        try {
          const { data, error } = await supabase
            .from("points_rules")
            .select("source_kind, points")
            .in("source_kind", ["triage_event", "photo_rating_event"]);
          if (error) throw error;
          const bySource: Partial<Record<PointsSourceKind, number>> = {};
          for (const row of data ?? []) {
            const kind = (row as { source_kind: string }).source_kind as PointsSourceKind;
            bySource[kind] = (row as { points: number }).points;
          }
          if (bySource.triage_event != null && bySource.photo_rating_event == null) {
            bySource.photo_rating_event = bySource.triage_event;
          }
          return bySource;
        } catch (err: unknown) {
          console.warn(
            "[points] rules fetch failed:",
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      })();
      const totalsPromise = userId
        ? fetchSelfPointsTotal(supabase, userId).catch((err) => {
            console.warn(
              "[points] initial totals fetch failed:",
              err instanceof Error ? err.message : err,
            );
            return null;
          })
        : Promise.resolve(null);
      const [rule, totals] = await Promise.all([rulePromise, totalsPromise]);
      if (cancelled) return;
      setState({
        rulePointsBySource: rule ?? {},
        total: userId ? totals?.totalPoints ?? 0 : null,
        eventCount: userId ? totals?.eventCount ?? 0 : null,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, userId]);

  // Reconcile on window focus — a triage submit elsewhere or an admin
  // rule change will surface within seconds without a manual refresh.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const bumpAfterReviewEvent = React.useCallback(
    (source: PointsSourceKind = "triage_event"): ReviewBumpResult | null => {
      let result: ReviewBumpResult | null = null;
      setState((s) => {
        if (s.total === null || s.eventCount === null) return s;
        const inc =
          s.rulePointsBySource[source] ??
          s.rulePointsBySource.triage_event ??
          0;
        const newTotal = s.total + inc;
        const newEventCount = s.eventCount + 1;
        result = { earned: inc, newTotal, newEventCount };
        return { ...s, total: newTotal, eventCount: newEventCount };
      });
      return result;
    },
    [],
  );

  const bumpAfterTriageEvent = React.useCallback(() => {
    void bumpAfterReviewEvent("triage_event");
  }, [bumpAfterReviewEvent]);

  const value = React.useMemo<PointsContextValue>(
    () => ({ ...state, loading, refresh, bumpAfterReviewEvent, bumpAfterTriageEvent }),
    [state, loading, refresh, bumpAfterReviewEvent, bumpAfterTriageEvent],
  );

  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>;
}

export function usePoints(): PointsContextValue {
  return React.useContext(PointsContext);
}
