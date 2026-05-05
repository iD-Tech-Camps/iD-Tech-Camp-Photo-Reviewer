"use client";

import React from "react";
import { createClient } from "@/lib/supabase/client";

export type Role = "staff" | "senior" | "admin";

export const ROLE_LABEL: Record<Role, string> = {
  staff:  "Staff Reviewer",
  senior: "Senior Reviewer",
  admin:  "Admin",
};

export type CurrentUser = {
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  initials: string;
  loading: boolean;
  role: Role;
  setRole: (role: Role) => void;
};

const FALLBACK: CurrentUser = {
  email: null,
  fullName: null,
  firstName: null,
  initials: "··",
  loading: true,
  role: "staff",
  setRole: () => {},
};

const ROLE_STORAGE_KEY = "current-user-role-v1";

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

function readStoredRole(): Role {
  if (typeof window === "undefined") return "staff";
  const raw = window.localStorage.getItem(ROLE_STORAGE_KEY);
  if (raw === "staff" || raw === "senior" || raw === "admin") return raw;
  return "staff";
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<CurrentUser>(FALLBACK);
  const [role, setRoleState] = React.useState<Role>("staff");

  React.useEffect(() => {
    setRoleState(readStoredRole());
  }, []);

  const setRole = React.useCallback((next: Role) => {
    setRoleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    }
  }, []);

  React.useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const apply = (data: { email?: string | null; user_metadata?: Record<string, any> | null } | null) => {
      if (cancelled) return;
      if (!data) {
        setUser({ ...FALLBACK, loading: false, role, setRole });
        return;
      }
      const meta = data.user_metadata || {};
      const fullName: string | null =
        meta.full_name || meta.name ||
        ([meta.given_name, meta.family_name].filter(Boolean).join(" ") || null);
      const email = data.email ?? null;
      setUser({
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
        setRole,
      });
    };

    supabase.auth.getUser().then(({ data }) => apply(data.user as any));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user as any);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [role, setRole]);

  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useCurrentUser(): CurrentUser {
  return React.useContext(UserContext);
}
