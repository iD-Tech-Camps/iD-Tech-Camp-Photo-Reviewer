"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { createClient } from "@/lib/supabase/client";
import { useSettings } from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";
import { brandingAssetUrl } from "@/lib/app-settings";

// Sidebar nav — pared back during the triage refactor's demolition pass.
// The reviewer/senior surfaces (Review, Profile, Guide, Flag review) are
// gone; the triage hub + senior dashboard land in Step 3 and slot in
// here. Until then everyone sees a single "Triage" placeholder; admins
// also see the Admin section.
export function Sidebar({
  current,
  onNav,
}: {
  current: string;
  onNav: (id: string) => void;
}) {
  const { settings } = useSettings();
  const { email, fullName, firstName, initials, loading, role } = useCurrentUser();
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

  const canSeeAdmin = role === "admin";
  const canSeeSenior = role === "senior" || role === "admin";

  const userItems: { id: string; label: string; icon: string }[] = [
    { id: "triage", label: "Camp Quality Review", icon: "review" },
    ...(canSeeSenior ? [{ id: "senior-review", label: "Lead review", icon: "stars" }] : []),
  ];

  // Admin entries the demolition pass leaves standing. The remaining
  // pre-refactor admin screens (Points & rules, Example library) are
  // gone; Tags is extracted from the old Points & rules card into its
  // own slot so admins can still manage the tag library while Step 3
  // builds out the triage surfaces.
  const adminItems = [
    { id: "admin-overview",  label: "Overview",        icon: "users" },
    { id: "admin-locations", label: "Location notes",  icon: "tag" },
    { id: "admin-tags",      label: "Issue library",   icon: "tag" },
    { id: "admin-smugmug",   label: "Photo sync",      icon: "download" },
    { id: "admin-settings",  label: "App settings",    icon: "gear" },
  ];

  const supabaseRef = React.useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const logoUrl = settings.faviconStoragePath
    ? brandingAssetUrl(supabaseRef.current, settings.faviconStoragePath)
    : null;

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandLogo url={logoUrl} alt={settings.brandName} />
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
        </button>
      ))}

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

// Sidebar/preview logo. Renders the admin-uploaded favicon when present;
// falls back to a blank tile so the brand row keeps its alignment when
// no favicon has been configured yet.
export function BrandLogo({
  url,
  alt,
  size = 32,
}: {
  url: string | null;
  alt: string;
  size?: number;
}) {
  if (!url) {
    return <div className="brand-mark" aria-hidden="true" style={{ width: size, height: size }} />;
  }
  return (
    <div className="brand-mark brand-mark-image" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
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

type Toast = { id: number; kind: "info"; msg: string; icon?: string; tone?: string };

export function useToast() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id" | "kind">) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { ...t, id, kind: "info" }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 2400);
  };
  const show = (msg: string, icon?: string) => push({ msg, icon });

  const node = (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={"toast" + (t.tone ? " toast-" + t.tone : "")}>
          {t.icon && <Icon name={t.icon} size={15} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
  return { show, node };
}

export type ToastApi = ReturnType<typeof useToast>;
