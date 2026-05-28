"use client";

import React from "react";
import { BrandLogo } from "@/components/Shell";
import { createClient } from "@/lib/supabase/client";
import type { PublicBranding } from "@/lib/app-settings-server";

const ACCENT_MAP: Record<PublicBranding["accent"], string> = {
  sun: "oklch(0.72 0.17 55)",
  lake: "oklch(0.58 0.11 230)",
  moss: "oklch(0.55 0.12 155)",
  rose: "oklch(0.62 0.16 25)",
};

export function LoginForm({ branding }: { branding: PublicBranding }) {
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  // Dev-only password sign-in. NEXT_PUBLIC_DEV_AUTH must be set to "1" at
  // build/dev time; production deploys leave it unset and never render this.
  const devAuthEnabled = process.env.NEXT_PUBLIC_DEV_AUTH === "1";
  const [devEmail, setDevEmail] = React.useState("");
  const [devPassword, setDevPassword] = React.useState("");

  React.useEffect(() => {
    const color = ACCENT_MAP[branding.accent] ?? ACCENT_MAP.sun;
    document.documentElement.style.setProperty("--sun", color);
  }, [branding.accent]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth_failed") {
      setErrorMsg("Sign-in failed. Please try again.");
    }
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setLoading(false);
      setErrorMsg("Could not start sign-in. Please try again.");
    }
  };

  const handleDevSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devAuthEnabled) return;
    setLoading(true);
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: devEmail,
      password: devPassword,
    });
    if (error) {
      setLoading(false);
      setErrorMsg(error.message);
      return;
    }
    window.location.href = "/";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--paper)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--radius-lg)",
          padding: 36,
          boxShadow: "var(--shadow-md)",
          textAlign: "center",
        }}
      >
        <div
          className="brand"
          style={{
            justifyContent: "center",
            marginBottom: 28,
          }}
        >
          <BrandLogo url={branding.logoUrl} alt={branding.brandName} size={40} />
          <div style={{ textAlign: "left" }}>
            <div className="brand-name">{branding.brandName}</div>
            <div className="brand-tag">{branding.brandTagline}</div>
          </div>
        </div>

        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            fontWeight: 450,
            letterSpacing: "-0.02em",
            margin: "0 0 8px",
            lineHeight: 1.15,
          }}
        >
          Sign in to continue
        </h1>
        <p
          style={{
            color: "var(--ink-3)",
            fontSize: 14,
            margin: "0 0 24px",
          }}
        >
          Use your <strong style={{ color: "var(--ink-2)", fontWeight: 500 }}>@idtech.com</strong> Google account.
        </p>

        <button
          className="btn btn-primary btn-lg"
          onClick={handleSignIn}
          disabled={loading}
          style={{ width: "100%", opacity: loading ? 0.7 : 1 }}
        >
          <GoogleMark />
          <span>{loading ? "Redirecting…" : "Sign in with Google"}</span>
        </button>

        {errorMsg && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--rose-soft)",
              color: "var(--rose)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
            }}
          >
            {errorMsg}
          </div>
        )}

        {devAuthEnabled && (
          <form
            onSubmit={handleDevSignIn}
            style={{
              marginTop: 24,
              paddingTop: 20,
              borderTop: "1px dashed var(--rule)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Dev sign-in (local only)
            </div>
            <input
              type="email"
              placeholder="email"
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              required
              style={{ padding: 8, border: "1px solid var(--rule)", borderRadius: 6, fontSize: 13 }}
            />
            <input
              type="password"
              placeholder="password"
              value={devPassword}
              onChange={(e) => setDevPassword(e.target.value)}
              required
              style={{ padding: 8, border: "1px solid var(--rule)", borderRadius: 6, fontSize: 13 }}
            />
            <button type="submit" className="btn btn-ghost" disabled={loading}>
              Sign in (dev)
            </button>
          </form>
        )}

        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: "1px solid var(--rule)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Staff only · iD Tech Camp
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.6 39.7 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
