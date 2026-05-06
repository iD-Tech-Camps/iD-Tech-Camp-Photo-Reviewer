"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import {
  useSettings,
  useBonusPeriods,
  activeBonusPeriod,
  formatBonusWindow,
  formatBonusMultiplier,
  type BonusPeriod,
} from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";
import { fetchFlaggedCount } from "@/lib/reviews";

export function Sidebar({
  current,
  onNav,
  pendingCount,
}: {
  current: string;
  onNav: (id: string) => void;
  pendingCount?: number;
}) {
  const { settings } = useSettings();
  const { email, fullName, firstName, initials, loading, role } = useCurrentUser();
  const [signingOut, setSigningOut] = React.useState(false);
  const [flaggedCount, setFlaggedCount] = React.useState<number | null>(null);

  // Pull the live flagged-queue count for the senior badge. Only seniors and
  // admins see the badge, so skip the query for plain reviewers to save a
  // round-trip.
  const canSeeFlaggedBadge = role === "senior" || role === "admin";
  React.useEffect(() => {
    if (!canSeeFlaggedBadge) {
      setFlaggedCount(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    fetchFlaggedCount(supabase)
      .then((n) => { if (!cancelled) setFlaggedCount(n); })
      .catch((err) => {
        console.warn("[sidebar] flagged count fetch failed:", err?.message ?? err);
        if (!cancelled) setFlaggedCount(null);
      });
    return () => { cancelled = true; };
  }, [canSeeFlaggedBadge, current]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const displayName = fullName || firstName || (email ? email.split("@")[0] : (loading ? "…" : "Reviewer"));
  const avatarInitials = loading ? "··" : initials;

  const canSeeFlagReview = canSeeFlaggedBadge;
  const canSeeAdmin = role === "admin";

  const userItems: { id: string; label: string; icon: string; badge?: number }[] = [
    { id: "review",   label: "Review",           icon: "review", badge: pendingCount },
    { id: "profile",  label: "My profile",       icon: "user" },
    { id: "guide",    label: "Guide & examples", icon: "book" },
  ];

  const seniorItems: { id: string; label: string; icon: string; badge?: number }[] = [
    { id: "flag-review", label: "Flag review", icon: "flag", badge: flaggedCount ?? undefined },
  ];

  const adminItems = [
    { id: "admin-overview",   label: "Overview",       icon: "users" },
    { id: "admin-assignment", label: "Assignment",     icon: "sliders" },
    { id: "admin-points",     label: "Points & rules", icon: "medal" },
    { id: "admin-examples",   label: "Example library",icon: "image" },
    { id: "admin-settings",   label: "App settings",   icon: "gear" },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span>{settings.brandMark}</span></div>
        <div>
          <div className="brand-name">{settings.brandName}</div>
          <div className="brand-tag">{settings.brandTagline}</div>
        </div>
      </div>

      <div className="nav-section">Reviewer</div>
      {userItems.map(it => (
        <button
          key={it.id}
          className={"nav-item" + (current === it.id ? " active" : "")}
          onClick={() => onNav(it.id)}
        >
          <Icon name={it.icon} />
          <span>{it.label}</span>
          {it.badge ? <span className="badge">{it.badge}</span> : null}
        </button>
      ))}

      {canSeeFlagReview && (
        <>
          <div className="nav-section">Senior</div>
          {seniorItems.map(it => (
            <button
              key={it.id}
              className={"nav-item" + (current === it.id ? " active" : "")}
              onClick={() => onNav(it.id)}
            >
              <Icon name={it.icon} />
              <span>{it.label}</span>
              {it.badge ? <span className="badge">{it.badge}</span> : null}
            </button>
          ))}
        </>
      )}

      {canSeeAdmin && (
        <>
          <div className="nav-section">Admin</div>
          {adminItems.map(it => (
            <button
              key={it.id}
              className={"nav-item" + (current === it.id ? " active" : "")}
              onClick={() => onNav(it.id)}
            >
              <Icon name={it.icon} />
              <span>{it.label}</span>
            </button>
          ))}
        </>
      )}

      <div className="sidebar-footer" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="avatar">{avatarInitials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={email ?? undefined}
            >
              {displayName}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={email ?? undefined}
            >
              {email ?? "Loading…"}
            </div>
          </div>
          <button
            className="nav-item"
            style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }}
            title="Sign out"
            aria-label="Sign out"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <Icon name="log-out" size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function PageHeader({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title" dangerouslySetInnerHTML={{ __html: title }} />
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{children}</div>}
    </div>
  );
}

export function fireConfetti(
  x: number = typeof window !== "undefined" ? window.innerWidth / 2 : 0,
  y: number = typeof window !== "undefined" ? window.innerHeight / 3 : 0,
  count: number = 80,
) {
  if (typeof document === "undefined") return;
  const colors = [
    "oklch(0.72 0.17 55)",
    "oklch(0.58 0.11 230)",
    "oklch(0.55 0.12 155)",
    "oklch(0.62 0.16 25)",
    "oklch(0.75 0.14 95)",
  ];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.background = colors[i % colors.length];
    el.style.left = x + "px";
    el.style.top = y + "px";
    const angle = Math.random() * Math.PI * 2;
    const velocity = 200 + Math.random() * 300;
    const dx = Math.cos(angle) * velocity;
    const dy = Math.sin(angle) * velocity - 150;
    const rot = Math.random() * 720 - 360;
    const dur = 1400 + Math.random() * 800;
    el.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx}px, ${dy + 500}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: dur, easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), dur);
  }
}

type InfoToast   = { id: number; kind: "info";   msg: string; icon?: string; tone?: string };
type PointsToast = { id: number; kind: "points"; amount: number; label: string };
type Toast = InfoToast | PointsToast;

export function useToast() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = (t: Omit<InfoToast, "id"> | Omit<PointsToast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { ...t, id } as Toast]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 2400);
  };
  const show = (msg: string, icon?: string) => push({ kind: "info", msg, icon });
  const showPoints = (amount: number, label = "points") =>
    push({ kind: "points", amount, label });

  const node = (
    <div className="toast-stack">
      {toasts.map(t => {
        if (t.kind === "points") {
          return (
            <div key={t.id} className="toast toast-points">
              <Icon name="stars" size={20} />
              <div>
                <div className="toast-amount">+{t.amount}</div>
                <div className="toast-label">{t.label}</div>
              </div>
            </div>
          );
        }
        return (
          <div key={t.id} className={"toast" + (t.tone ? " toast-" + t.tone : "")}>
            {t.icon && <Icon name={t.icon} size={15} />}
            <span>{t.msg}</span>
          </div>
        );
      })}
    </div>
  );
  return { show, showPoints, node };
}

export type ToastApi = ReturnType<typeof useToast>;

// Returns the currently-active Points Multiplier Bonus (if any) and
// re-evaluates on a timer so windows that start or end mid-session update
// without a refresh. Both HomeScreen and ReviewScreen subscribe so they
// stay in sync. Tick interval is 30s — fine-grained enough that "ends in
// 1 minute" wraps cleanly into "no bonus" without a noticeable delay, but
// not so frequent that we waste re-renders.
export function useActiveBonusPeriod(): BonusPeriod | null {
  const { periods } = useBonusPeriods();
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return React.useMemo(
    () => activeBonusPeriod(periods),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periods, tick],
  );
}

// Visible callout that a Points Multiplier Bonus is currently active.
// Two presentation modes:
//
//   * `compact` — a single `pennant`-styled flag with multiplier + label +
//     window. Used inside the ReviewScreen header where horizontal space
//     is at a premium.
//   * `banner` — a softer, ~2-line callout with the same info, intended
//     for the HomeScreen where the reviewer is still deciding whether to
//     start a session.
//
// Both share the same source data and the same window-formatter, so the
// content is consistent — only the chrome differs.
export function BonusPennant({
  period,
  variant = "compact",
}: {
  period: BonusPeriod;
  variant?: "compact" | "banner";
}) {
  const mult = formatBonusMultiplier(period.multiplier);
  const label = period.label?.trim() || `${mult} bonus`;
  const window = formatBonusWindow(period);

  if (variant === "compact") {
    return (
      <span
        className="pennant"
        style={{ fontWeight: 600 }}
        title={`Multiplier bonus active — ${label}, ${window}`}
      >
        {mult}&nbsp;·&nbsp;{label.toUpperCase()}
        {window && <>&nbsp;·&nbsp;{window.toUpperCase()}</>}
      </span>
    );
  }

  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 18px",
        borderRadius: "var(--radius-sm)",
        background: "var(--sun-soft)",
        border: "1px solid var(--sun)",
        color: "var(--ink)",
        textAlign: "left",
        maxWidth: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            fontWeight: 600,
            color: "var(--sun)",
            letterSpacing: "-0.01em",
          }}
        >
          {mult}
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </span>
        <span className="pill pill-sun" style={{ fontSize: 10 }}>
          Active
        </span>
      </div>
      {window && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-2)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          {window}
        </div>
      )}
    </div>
  );
}
