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
//
// `previewSrc` (optional) lets a caller paint a low-fidelity preview (the
// already-cached thumbnail) under the main image while the larger variant
// downloads. The preview is rendered as a separate <img> layer with a
// blur/scale filter so it reads as "loading hint, not final" — the main
// image fades over it on load, and the preview stays visible if the main
// image errors (blurry-but-present beats no-image). Without this prop the
// renderer behaves exactly as it did before (skeleton + single image).

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
  // Render an animated spinner in the loading state instead of a silent
  // skeleton. Used by the lightbox where a flat panel reads as broken.
  showSpinner?: boolean;
  // Low-fidelity URL painted behind the main image as a progressive load
  // hint. Used by the lightbox to render the cached thumbnail (instant)
  // under the XL variant while the latter downloads.
  previewSrc?: string | null;
};

export function PhotoImg({
  src,
  alt,
  loading = "lazy",
  fit = "cover",
  onClick,
  className,
  background = "var(--paper-3)",
  showSpinner = false,
  previewSrc,
}: PhotoImgProps) {
  // Tracks load state per src so swapping photos resets the skeleton.
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error",
  );
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  // Reset state when src changes — but reconcile against the DOM: if the
  // image was preloaded (e.g. lightbox neighbor cache), onLoad may have
  // fired before this effect runs, so the React event handler never sees
  // it. Without this sync, the skeleton would sit forever on cached
  // photos when arrowing back into them.
  React.useEffect(() => {
    if (!src) {
      setStatus("error");
      return;
    }
    const img = imgRef.current;
    if (img && img.complete) {
      setStatus(img.naturalWidth > 0 ? "loaded" : "error");
    } else {
      setStatus("loading");
    }
  }, [src]);

  // "No image" fallback. With `previewSrc` the preview can still carry the
  // load — blurry-but-present is a better degradation than a flat tile.
  if ((!src || status === "error") && !previewSrc) {
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
      {previewSrc && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={previewSrc}
          alt=""
          aria-hidden
          decoding="async"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: fit,
            // Scale slightly so the blur doesn't reveal a hard edge inside
            // the container; the blur reads as "still loading, not final".
            filter: "blur(8px)",
            transform: "scale(1.05)",
          }}
        />
      )}
      {!previewSrc && status === "loading" && (
        <div
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            background,
            display: showSpinner ? "grid" : undefined,
            placeItems: showSpinner ? "center" : undefined,
          }}
        >
          {showSpinner && <span className="photo-spinner" aria-hidden />}
        </div>
      )}
      {src && status !== "error" && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          ref={imgRef}
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
      )}
    </>
  );
}
