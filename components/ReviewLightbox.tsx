"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { PhotoImg } from "@/components/PhotoImg";
import { BatchPointsHud } from "@/components/BatchPointsHud";

// Shared lightbox shell for the review hubs (Camp Quality Review + Camp Photo
// Review). Both screens overlay the same chrome — backdrop, close, prev/next
// nav, the hero image — and differ only in the controls card. This is a
// non-mobile app on horizontal screens, so the layout puts the controls card
// on the LEFT at a fixed width and hands the rest of the width to the image,
// which fills the full overlay height (the old stacked layout capped the hero
// at 62vh and looked tiny on short laptop screens).
//
// The controls card splits into a scrolling body (`children` — tags, which can
// grow) and a pinned `footer` (the submit / score controls) that stays visible
// no matter how long the tag list gets. The points readout sits quietly at the
// foot of the scrolling body rather than as a floating HUD over the photo.

export function ReviewLightbox({
  heroSrc,
  previewSrc,
  alt,
  position,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
  onDigitKey,
  lastEarned,
  children,
  footer,
}: {
  heroSrc: string | null | undefined;
  previewSrc: string | null | undefined;
  alt: string;
  // Top-left caption, e.g. "3 / 12 · 4 stars".
  position: string;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  // Optional 1–5 number-key handler (rating hub uses it to set the score).
  onDigitKey?: (n: number) => void;
  // Points earned on the latest submit — drives the +N float in the body HUD.
  lastEarned: number | null;
  // Scrolling controls body (tags, etc.).
  children: React.ReactNode;
  // Pinned action controls (submit / score) that never scroll out of view.
  footer: React.ReactNode;
}) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      // Don't hijack typing in form fields.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
      else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
      else if (onDigitKey && e.key >= "1" && e.key <= "5") { e.preventDefault(); onDigitKey(Number(e.key)); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext, hasPrev, hasNext, onDigitKey]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.86)",
        display: "flex",
        padding: 16,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{ ...chromeButtonStyle, position: "absolute", top: 16, right: 16, zIndex: 2 }}
      >
        <Icon name="x" size={20} />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1, minWidth: 0, minHeight: 0,
          display: "flex", gap: 16,
        }}
      >
        <aside
          style={{
            width: 320, flexShrink: 0,
            alignSelf: "flex-start",
            maxHeight: "100%",
            display: "flex", flexDirection: "column",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 16 }}>
            {children}
            {/* Points readout lives quietly at the foot of the body rather than
                as a floating HUD over the photo. */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--rule)" }}>
              <BatchPointsHud lastEarned={lastEarned} />
            </div>
          </div>
          {/* Pinned: stays put while the tag list above scrolls. */}
          <div style={{ flexShrink: 0, borderTop: "1px solid var(--rule)", padding: 16 }}>
            {footer}
          </div>
        </aside>

        <div style={{ position: "relative", flex: 1, minWidth: 0, height: "100%" }}>
          <PhotoImg
            src={heroSrc ?? null}
            previewSrc={previewSrc}
            alt={alt}
            fit="contain"
            loading="eager"
            background="transparent"
            showSpinner
          />

          <div
            style={{
              position: "absolute", top: 12, left: 12,
              padding: "4px 10px", borderRadius: 999,
              background: "rgba(0,0,0,0.45)",
              color: "white",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              pointerEvents: "none",
            }}
          >
            {position}
          </div>

          {hasPrev && (
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous photo"
              style={{ ...navButtonStyle, left: 12 }}
            >
              <Icon name="arrow-l" size={22} />
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={onNext}
              aria-label="Next photo"
              style={{ ...navButtonStyle, right: 12 }}
            >
              <Icon name="arrow-r" size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const chromeButtonStyle: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 999,
  background: "rgba(255,255,255,0.12)", color: "white",
  border: "none", cursor: "pointer",
  display: "grid", placeItems: "center",
};

const navButtonStyle: React.CSSProperties = {
  position: "absolute", top: "50%", transform: "translateY(-50%)",
  width: 48, height: 48, borderRadius: 999,
  background: "rgba(255,255,255,0.12)", color: "white",
  border: "none", cursor: "pointer",
  display: "grid", placeItems: "center",
};
