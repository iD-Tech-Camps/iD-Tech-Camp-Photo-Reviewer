"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import { BonusPennant, PageHeader, useActiveBonusPeriod } from "@/components/Shell";
import { PhotoImg } from "@/components/PhotoImg";
import { useSettings, fillTemplate } from "@/components/settings";
import { useCurrentUser } from "@/lib/current-user";
import { createClient } from "@/lib/supabase/client";
import { fetchRecentPhotoThumbs, type HeroThumb } from "@/lib/reviews";

// Decorative thumbnail strip on the home screen. As of step 8.6 these are
// real SmugMug thumbnails pulled from `photos.thumbnail_url` for the next
// 10 pending photos in queue order — the strip doubles as a "what's
// coming up" preview rather than a random sample. When the queue is
// empty (off-season, fresh DB), the strip collapses entirely so the
// header doesn't dangle a row of empty tiles.
const HERO_THUMB_COUNT = 10;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function greetingHtml(template: string, name: string): string {
  return fillTemplate(escapeHtml(template), { name: escapeHtml(name) });
}

export function HomeScreen({
  onStart,
  onNav,
  pendingCount,
}: {
  onStart: () => void;
  onNav: (screen: string) => void;
  pendingCount?: number;
}) {
  const { settings } = useSettings();
  const { firstName } = useCurrentUser();
  const activePeriod = useActiveBonusPeriod();
  const reviewerName = firstName || "there";
  const greeting = greetingHtml(settings.homeGreeting, reviewerName);
  const subtitle = fillTemplate(settings.homeSubtitle, {
    name: reviewerName,
    count: pendingCount ?? "—",
  });

  // Pull the next-up photos for the decorative strip. We don't block the
  // page render on this; the strip just doesn't show until thumbs arrive.
  // Failure is silent — the strip is decorative and an offline DB shouldn't
  // gate getting to "Start reviewing".
  const [thumbs, setThumbs] = React.useState<HeroThumb[] | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetchRecentPhotoThumbs(createClient(), HERO_THUMB_COUNT)
      .then((rows) => { if (!cancelled) setThumbs(rows); })
      .catch((err) => {
        console.warn("[home-screen] thumbs fetch failed:", err?.message ?? err);
        if (!cancelled) setThumbs([]);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Monday · June 9"
        title={greeting}
        sub={subtitle}
      >
        <button className="btn btn-ghost" onClick={() => onNav("guide")}>
          <Icon name="book" size={14} /> Guide
        </button>
      </PageHeader>

      <div className="page-body" style={{
        display: "grid",
        placeItems: "center",
        minHeight: "calc(100vh - 200px)",
        paddingBottom: 0,
      }}>
        <div style={{ maxWidth: 640, width: "100%", textAlign: "center" }}>

          {thumbs && thumbs.length > 0 && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8,
              marginBottom: 28,
            }}>
              {thumbs.map((t) => (
                <div key={t.id} style={{
                  aspectRatio: "3/2",
                  borderRadius: 6,
                  overflow: "hidden",
                  position: "relative",
                  background: "var(--paper-3)",
                  boxShadow: "var(--shadow-sm)",
                }}>
                  <PhotoImg
                    src={t.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    fit="cover"
                  />
                </div>
              ))}
            </div>
          )}

          <h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: 44, fontWeight: 450, letterSpacing: "-0.02em",
            margin: "0 0 10px",
          }}>
            Start a batch of 10
          </h2>
          <p style={{
            color: "var(--ink-2)",
            fontSize: 14,
            margin: "0 0 28px",
            lineHeight: 1.5,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="kbd">A</span> approve
            </span>
            <span style={{ opacity: 0.3 }}>·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="kbd">F</span> flag
            </span>
          </p>

          <button className="btn btn-primary btn-lg" onClick={onStart}
            style={{ padding: "16px 32px", fontSize: 16, marginBottom: activePeriod ? 18 : 32 }}>
            <Icon name="play" size={16} /> Start reviewing
          </button>

          {activePeriod && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
              <BonusPennant period={activePeriod} variant="banner" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
