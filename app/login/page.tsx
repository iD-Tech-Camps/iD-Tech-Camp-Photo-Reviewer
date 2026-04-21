"use client";

import React from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

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
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 20 }}>
            <span>Ƭ</span>
          </div>
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 20,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              Treeline
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Photo Review · iD Tech
            </div>
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
