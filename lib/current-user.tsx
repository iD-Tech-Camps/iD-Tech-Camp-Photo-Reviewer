"use client";

import React from "react";
import { createClient } from "@/lib/supabase/client";

// Mirrors the `role` enum in the database (`reviewer | senior | admin`).
// Display labels live in ROLE_LABEL below — the schema's `reviewer` is shown
// to users as "Staff Reviewer" because that's how iD Tech refers to the role
// internally.
export type Role = "reviewer" | "senior" | "admin";

export const ROLE_LABEL: Record<Role, string> = {
  reviewer: "Staff Reviewer",
  senior:   "Lead Reviewer",
  admin:    "Admin",
};

export type Theme = "light" | "dark";

export type CurrentUser = {
  id: string | null;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  initials: string;
  loading: boolean;
  role: Role;
  // Per-user appearance preference (step 7.7c). Backed by `profiles.theme`;
  // `light` until the profile fetch completes so the first paint always
  // has a valid `data-theme`. Mutated through useUpdateTheme().
  theme: Theme;
};

const FALLBACK: CurrentUser = {
  id: null,
  email: null,
  fullName: null,
  firstName: null,
  initials: "··",
  loading: true,
  role: "reviewer",
  theme: "light",
};

type Ctx = {
  user: CurrentUser;
  // Update the signed-in user's theme. Optimistic; rolls back on DB failure.
  // Returns the resolved theme so callers can chain UI work off it.
  setTheme: (next: Theme) => Promise<Theme>;
};

const FALLBACK_CTX: Ctx = {
  user: FALLBACK,
  setTheme: async (t) => t,
};

const UserContext = React.createContext<Ctx>(FALLBACK_CTX);

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return "··";
}

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function firstNameFrom(fullName: string | null, email: string | null): string | null {
  if (fullName) {
    const first = fullName.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email) {
    const local = email.split("@")[0] || "";
    const part = local.split(/[._-]+/).filter(Boolean)[0];
    if (part) return part.charAt(0).toUpperCase() + part.slice(1);
  }
  return null;
}

function isRole(value: unknown): value is Role {
  return value === "reviewer" || value === "senior" || value === "admin";
}

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<CurrentUser>(FALLBACK);
  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    let cancelled = false;

    const apply = async (
      authUser: { id?: string | null; email?: string | null; user_metadata?: Record<string, any> | null } | null,
    ) => {
      if (cancelled) return;

      if (!authUser || !authUser.id) {
        setUser({ ...FALLBACK, loading: false });
        return;
      }

      const meta = authUser.user_metadata || {};
      const fullName: string | null =
        meta.full_name || meta.name ||
        ([meta.given_name, meta.family_name].filter(Boolean).join(" ") || null);
      const email = authUser.email ?? null;

      // Role + theme both live in `profiles`, keyed by auth.users.id. The
      // `handle_new_user` trigger creates the row on signup; if it's missing
      // the user signed up before that migration landed and needs a manual
      // backfill — fall back to safe defaults so the UI still renders.
      let role: Role = "reviewer";
      let theme: Theme = "light";
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role, theme")
        .eq("id", authUser.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn("[current-user] profiles lookup failed:", error.message);
      } else if (!profile) {
        console.warn(
          `[current-user] no profiles row for auth user ${authUser.id}; defaulting to 'reviewer'. ` +
          "Run the backfill insert in Supabase to fix.",
        );
      } else {
        if (isRole(profile.role)) role = profile.role;
        if (isTheme(profile.theme)) theme = profile.theme;
      }

      setUser({
        id: authUser.id,
        email,
        fullName,
        firstName: firstNameFrom(fullName, email),
        initials: fullName
          ? initialsFromName(fullName)
          : email
          ? initialsFromEmail(email)
          : "··",
        loading: false,
        role,
        theme,
      });
    };

    supabase.auth.getUser().then(({ data }) => apply(data.user as any));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply((session?.user as any) ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // Optimistic theme update. Allowed by the `profiles_update_self` RLS
  // policy from migration 9 — its with-check constrains role and team
  // only, so theme writes pass through. Falls back if there's no signed-in
  // user (we still flip local state so the picker feels responsive in
  // sign-out edge cases, but no DB write fires).
  const setTheme = React.useCallback(
    async (next: Theme): Promise<Theme> => {
      const previous = user.theme;
      setUser((u) => ({ ...u, theme: next }));
      if (!user.id) return next;
      const { error } = await supabase
        .from("profiles")
        .update({ theme: next })
        .eq("id", user.id);
      if (error) {
        console.error("[current-user] theme update failed:", error.message);
        setUser((u) => ({ ...u, theme: previous }));
        throw error;
      }
      return next;
    },
    [supabase, user.id, user.theme],
  );

  const ctx = React.useMemo<Ctx>(() => ({ user, setTheme }), [user, setTheme]);

  return <UserContext.Provider value={ctx}>{children}</UserContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  return React.useContext(UserContext).user;
}

// Separate hook so call sites that just want to read user data don't
// pull in the setter (and don't have to type-narrow it).
export function useUpdateTheme(): (next: Theme) => Promise<Theme> {
  return React.useContext(UserContext).setTheme;
}
