"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { useSettings } from "@/components/settings";
import { useCurrentUser, ROLE_LABEL, type Role } from "@/lib/current-user";
import { FLAGGED_PHOTOS } from "@/components/data";

export function Sidebar({
  current,
  onNav,
  pendingCount = 10,
}: {
  current: string;
  onNav: (id: string) => void;
  pendingCount?: number;
}) {
  const { settings } = useSettings();
  const { email, fullName, firstName, initials, loading, role, setRole } = useCurrentUser();
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const displayName = fullName || firstName || (email ? email.split("@")[0] : (loading ? "…" : "Reviewer"));
  const avatarInitials = loading ? "··" : initials;

  const canSeeFlagReview = role === "senior" || role === "admin";
  const canSeeAdmin = role === "admin";

  const userItems = [
    { id: "review",      label: "Review",             icon: "review", badge: pendingCount },
    settings.showLeaderboard
      ? { id: "leaderboard", label: "Stats & Leaderboard",icon: "trophy" }
      : null,
    { id: "profile",     label: "My profile",         icon: "user" },
    { id: "guide",       label: "Guide & examples",   icon: "book" },
  ].filter(Boolean) as { id: string; label: string; icon: string; badge?: number }[];

  const seniorItems: { id: string; label: string; icon: string; badge?: number }[] = [
    { id: "flag-review", label: "Flag review", icon: "flag", badge: FLAGGED_PHOTOS.length },
  ];

  const adminItems = [
    { id: "admin-overview",   label: "Overview",       icon: "bolt" },
    { id: "admin-assignment", label: "Assignment",     icon: "sliders" },
    { id: "admin-points",     label: "Points & rules", icon: "medal" },
    { id: "admin-examples",   label: "Example library",icon: "image" },
    { id: "admin-users",      label: "Users",          icon: "users" },
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
        <RoleSwitcher role={role} onChange={setRole} />
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

function RoleSwitcher({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  return (
    <label
      style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--paper-2)",
        border: "1px solid var(--rule)",
      }}
    >
      <span
        style={{
          fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
          color: "var(--ink-3)", fontFamily: "var(--font-mono)",
        }}
      >
        View as
      </span>
      <select
        value={role}
        onChange={(e) => onChange(e.target.value as Role)}
        style={{
          background: "transparent",
          border: "none",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ink)",
          padding: 0,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="staff">{ROLE_LABEL.staff}</option>
        <option value="senior">{ROLE_LABEL.senior}</option>
        <option value="admin">{ROLE_LABEL.admin}</option>
      </select>
    </label>
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
