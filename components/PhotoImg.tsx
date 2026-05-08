"use client";

// Step 8.6 — shared photo renderer.
//
// Replaced the prototype-era `PhotoPlaceholder` gradient stand-in (deleted
// from `components/data.tsx`) once `image_url` / `thumbnail_url` started
// flowing through from the 8.4 SmugMug sync. Three states matter:
//
//   1. URL missing entirely (e.g. older sync runs that didn't capture
//      ArchivedUri / ThumbnailUrl) → render an inert "no image" tile.
//   2. URL present, image still loading → render a paper-2 skeleton so the
//      layout doesn't collapse on first paint.
//   3. URL present, browser failed to load it (network / 404 / referer
//      rejection) → swap to the same "no image" tile as state 1.
//
// All three states preserve the parent's box dimensions — the component
// always fills its container with `position: absolute; inset: 0`. Callers
// stay responsible for the wrapping aspect-ratio box; this is consistent
// with how the prototype's PhotoPlaceholder worked, so the swap-in at
// each consumer is a pure replacement (no layout churn).
//
// The component renders a plain `<img>` rather than `next/image` because
// SmugMug serves variants directly and we don't want Next's image
// optimization pipeline to proxy them — extra latency, extra bandwidth,
// and a fight with SmugMug's hotlink referer rules. The `loading="lazy"`
// hint is enough for the grid views; the reviewer hero opts out via
// `eager` since it's the only thing on screen.

import React from "react";

export type PhotoImgProps = {
  src: string | null;
  alt: string;
  // Reviewer hero / senior detail card paint immediately and shouldn't wait
  // for an intersection observer; everything else (queue lists, decorative
  // strips) defers via the lazy hint to keep first paint cheap.
  loading?: "lazy" | "eager";
  // Object-fit posture. Defaults to `cover` (matches the placeholder's
  // bleed-to-edge behavior); the senior detail card uses `contain` so
  // landscape and portrait photos both render correctly without
  // cropping the subject.
  fit?: "cover" | "contain";
  // Optional click handler — used by the reviewer hero so a click anywhere
  // on the photo can act like keyboard input did during 7.x review flows.
  onClick?: () => void;
  className?: string;
  // Background behind the `<img>` while it loads. Defaults to var(--paper-3)
  // so the skeleton state matches the parent card surface.
  background?: string;
};

export function PhotoImg({
  src,
  alt,
  loading = "lazy",
  fit = "cover",
  onClick,
  className,
  background = "var(--paper-3)",
}: PhotoImgProps) {
  // Tracks load state per src so swapping photos resets the skeleton.
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error",
  );

  React.useEffect(() => {
    setStatus(src ? "loading" : "error");
  }, [src]);

  if (!src || status === "error") {
    return (
      <div
        onClick={onClick}
        className={className}
        style={{
          position: "absolute", inset: 0,
          background,
          display: "grid", placeItems: "center",
          color: "var(--ink-3)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: onClick ? "pointer" : "default",
        }}
      >
        No image
      </div>
    );
  }

  return (
    <>
      {status === "loading" && (
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            background,
          }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        onClick={onClick}
        className={className}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: fit,
          // Hide the half-decoded image until the browser confirms load —
          // SmugMug occasionally serves a partial response on referer
          // rejection that flashes a broken icon otherwise.
          opacity: status === "loaded" ? 1 : 0,
          transition: "opacity 0.18s ease",
          cursor: onClick ? "pointer" : "default",
        }}
      />
    </>
  );
}
