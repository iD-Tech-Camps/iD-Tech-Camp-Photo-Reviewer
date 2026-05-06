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
  senior:   "Senior Reviewer",
  admin:    "Admin",
};

export type CurrentUser = {
  id: string | null;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  initials: string;
  loading: boolean;
  role: Role;
};

const FALLBACK: CurrentUser = {
  id: null,
  email: null,
  fullName: null,
  firstName: null,
  initials: "··",
  loading: true,
  role: "reviewer",
};

const UserContext = React.createContext<CurrentUser>(FALLBACK);

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

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<CurrentUser>(FALLBACK);

  React.useEffect(() => {
    const supabase = createClient();
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

      // Role lives in `profiles`, keyed by auth.users.id. The
      // `handle_new_user` trigger creates the row on signup; if it's missing
      // the user signed up before that migration landed and needs a manual
      // backfill — fall back to 'reviewer' so the UI still renders.
      let role: Role = "reviewer";
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
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
      } else if (isRole(profile.role)) {
        role = profile.role;
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
  }, []);

  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  return React.useContext(UserContext);
}
