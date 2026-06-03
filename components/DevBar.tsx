"use client";

import React from "react";
import { useCurrentUser, ROLE_LABEL, type Role } from "@/lib/current-user";
import type { ToastApi } from "@/components/Shell";

// Dev-only toolbar (rendered only when NEXT_PUBLIC_DEV_AUTH=1). Lets the single
// local dev login switch role to preview each view, and reseed the local
// gallery data from the captured fixture. Never shipped to production.
export function DevBar({ toast }: { toast: ToastApi }) {
  const { role, email, loading } = useCurrentUser();
  const [busy, setBusy] = React.useState(false);

  if (loading || !email) return null;

  const setRole = async (next: Role) => {
    if (next === role || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dev/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "role change failed");
      window.location.reload();
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : "Role change failed", "x");
      setBusy(false);
    }
  };

  const reseed = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dev/seed", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "reseed failed");
      toast.show(`Reseeded ${json.photos} photos · ${json.reviewers} reviewers`, "check");
      setTimeout(() => window.location.reload(), 600);
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : "Reseed failed", "x");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)",
        zIndex: 2000, display: "flex", alignItems: "center", gap: 12,
        padding: "8px 14px", borderRadius: 999,
        background: "var(--ink)", color: "var(--paper)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        fontSize: 12, fontFamily: "var(--font-mono)",
      }}
    >
      <span style={{ opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.1em" }}>Dev</span>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Role
        <select
          value={role}
          disabled={busy}
          onChange={(e) => void setRole(e.target.value as Role)}
          style={{ background: "var(--paper)", color: "var(--ink)", borderRadius: 6, padding: "3px 6px", fontSize: 12 }}
        >
          {(["reviewer", "senior", "admin"] as Role[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void reseed()}
        disabled={busy}
        style={{
          background: "var(--sun)", color: "white", border: "none",
          borderRadius: 999, padding: "4px 12px", cursor: busy ? "default" : "pointer",
          fontSize: 12, fontWeight: 600, opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Working…" : "Reseed dev data"}
      </button>
    </div>
  );
}
