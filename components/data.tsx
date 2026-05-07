"use client";

// This file used to host the prototype's mock data (SESSION_PHOTOS, BADGES,
// RECENT_ACTIVITY, ADMIN_USERS, FLAGGED_PHOTOS, NEGATIVE_TAGS, PHOTO_TAGS,
// EXAMPLES). All of those are now backed by Supabase tables and fetched
// through dedicated lib modules:
//
//   tags          → lib/tags.ts          (live `tags` table, since 7.6a)
//   examples      → lib/examples.ts      (live `examples` table + Storage, since 7.6b)
//   reviewer roster → lib/profile.ts     (`reviewer_stats` view, since 7.5)
//   flagged queue → lib/reviews.ts       (`fetchFlaggedPhotos`, since 7.4)
//
// What remains here is the gradient-stand-in renderer: until real SmugMug
// thumbnails land in step 8, screens render `PhotoPlaceholder` to draw a
// deterministic colored card keyed off a photo id. Step 8 will replace the
// placeholder with real image rendering and most of these consumers will
// drop this import entirely.

import React from "react";

const PHOTO_PALETTES: [string, string][] = [
  ["oklch(0.72 0.12 55)", "oklch(0.55 0.08 30)"],
  ["oklch(0.75 0.10 150)","oklch(0.45 0.08 160)"],
  ["oklch(0.72 0.10 220)","oklch(0.48 0.10 230)"],
  ["oklch(0.82 0.08 85)", "oklch(0.55 0.06 65)"],
  ["oklch(0.70 0.10 15)", "oklch(0.40 0.10 25)"],
  ["oklch(0.78 0.09 120)","oklch(0.50 0.09 140)"],
  ["oklch(0.76 0.09 250)","oklch(0.50 0.08 255)"],
  ["oklch(0.80 0.09 45)", "oklch(0.52 0.09 35)"],
  ["oklch(0.73 0.10 190)","oklch(0.45 0.08 200)"],
  ["oklch(0.78 0.08 75)", "oklch(0.50 0.06 70)"],
];

export function photoPaletteFor(id: string): [string, string] {
  const n = id ? id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) : 0;
  return PHOTO_PALETTES[n % PHOTO_PALETTES.length];
}

type PhotoLike = { id: string; camp?: string; activity?: string };

export function PhotoPlaceholder({
  photo,
  compact = false,
  hideLabel = false,
}: {
  photo: PhotoLike;
  compact?: boolean;
  hideLabel?: boolean;
}) {
  const [c1, c2] = photoPaletteFor(photo.id);
  const n = photo.id.charCodeAt(photo.id.length - 1);
  const shape = n % 4;
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: `linear-gradient(160deg, ${c1} 0%, ${c2} 100%)`,
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", left: "-10%", right: "-10%", top: "55%", bottom: "-10%",
        background: `linear-gradient(180deg, ${c2} 0%, rgba(0,0,0,0.35) 100%)`,
        filter: "blur(8px)",
      }} />
      {shape === 0 && (
        <div style={{
          position: "absolute", left: "20%", top: "40%", width: "25%", aspectRatio: 1,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.18)",
          filter: "blur(20px)",
        }} />
      )}
      {shape === 1 && (
        <div style={{
          position: "absolute", left: "55%", top: "20%", width: "30%", aspectRatio: 1,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          filter: "blur(30px)",
        }} />
      )}
      {shape === 2 && (
        <div style={{
          position: "absolute", left: 0, right: 0, top: "62%", height: "3%",
          background: "rgba(0,0,0,0.15)",
          filter: "blur(4px)",
        }} />
      )}
      {shape === 3 && (
        <>
          <div style={{
            position: "absolute", left: "30%", top: "48%", width: "10%", aspectRatio: 0.4,
            background: "rgba(0,0,0,0.3)", borderRadius: "40% 40% 0 0",
            filter: "blur(1px)",
          }} />
          <div style={{
            position: "absolute", left: "55%", top: "52%", width: "8%", aspectRatio: 0.4,
            background: "rgba(0,0,0,0.3)", borderRadius: "40% 40% 0 0",
            filter: "blur(1px)",
          }} />
        </>
      )}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.35) 100%)",
      }} />
      {!hideLabel && (
        <div style={{
          position: "absolute", left: 16, bottom: 12, right: 16,
          color: "rgba(255,255,255,0.92)",
          fontFamily: "var(--font-mono)",
          fontSize: compact ? 9 : 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          display: "flex", justifyContent: "space-between", gap: 12,
          textShadow: "0 1px 2px rgba(0,0,0,0.4)",
        }}>
          <span>{photo.camp}</span>
          <span style={{ opacity: 0.8 }}>{photo.id}</span>
        </div>
      )}
    </div>
  );
}
