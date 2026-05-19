"use client";

import React from "react";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import {
  fetchSelfPointsTotal,
  fetchTriagePointsRule,
} from "@/lib/points";

// Shared points cache. Hosts the reviewer's all-time total + event count and
// the cached `points_rules.points` value for 'triage_event'. The submit path
// in components/screens/Triage.tsx calls `bumpAfterTriageEvent()` on a
// successful clean/flag insert so the chip + My Stats headline tick up
// immediately. The next focus or route entry reconciles against the
// server (`refresh()`).

type PointsState = {
  // null while loading the very first time; subsequently a number even when
  // the user has zero events.
  total: number | null;
  eventCount: number | null;
  // Cached rule.points for source_kind = 'triage_event'. Fetched once on
  // mount; the admin can change it via the App settings screen, but we
  // accept the (small) lag — a stale increment is corrected on next
  // reconcile fetch.
  rulePoints: number | null;
};

type PointsContextValue = PointsState & {
  loading: boolean;
  // Re-fetch authoritative totals from user_points_totals. Cheap.
  refresh: () => Promise<void>;
  // Optimistic increment after a successful clean/flag submit. Bumps total
  // by the cached rule value (defaults to 0 when the rule hasn't loaded —
  // the reconcile pass will fix it).
  bumpAfterTriageEvent: () => void;
};

const FALLBACK: PointsContextValue = {
  total: null,
  eventCount: null,
  rulePoints: null,
  loading: true,
  refresh: async () => {},
  bumpAfterTriageEvent: () => {},
};

const PointsContext = React.createContext<PointsContextValue>(FALLBACK);

export function PointsProvider({ children }: { children: React.ReactNode }) {
  const { id: userId } = useCurrentUser();
  const supabase = React.useMemo(() => createClient(), []);
  const [state, setState] = React.useState<PointsState>({
    total: null,
    eventCount: null,
    rulePoints: null,
  });
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    if (!userId) {
      setState({ total: null, eventCount: null, rulePoints: null });
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
      const rulePromise = fetchTriagePointsRule(supabase).catch((err) => {
        console.warn(
          "[points] rule fetch failed:",
          err instanceof Error ? err.message : err,
        );
        return null;
      });
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
        rulePoints: rule?.points ?? null,
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

  const bumpAfterTriageEvent = React.useCallback(() => {
    setState((s) => {
      if (s.total === null || s.eventCount === null) return s;
      const inc = s.rulePoints ?? 0;
      return { ...s, total: s.total + inc, eventCount: s.eventCount + 1 };
    });
  }, []);

  const value = React.useMemo<PointsContextValue>(
    () => ({ ...state, loading, refresh, bumpAfterTriageEvent }),
    [state, loading, refresh, bumpAfterTriageEvent],
  );

  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>;
}

export function usePoints(): PointsContextValue {
  return React.useContext(PointsContext);
}
