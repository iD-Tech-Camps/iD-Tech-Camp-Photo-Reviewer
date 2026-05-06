"use client";

// Tags moved to the live `tags` table (migration 4) and are read via
// lib/tags.ts → fetchTags(). Step 7.6a (May 2026) removed the NEGATIVE_TAGS,
// PHOTO_TAGS, and negativeTagLabel exports that previously lived here. If
// you need a label for a tag id, use buildTagLabelLookup(tags) — it covers
// inactive ids too, which negativeTagLabel didn't.
//
// EXAMPLES moved to the live `examples` table + Supabase Storage as part of
// step 7.6b (May 2026). Use lib/examples.ts → fetchExamples() to read the
// curated good/bad library; admin writes go through the same module.

import React from "react";

export const SESSION_PHOTOS = [
  { id: "IMG_4821", camp: "Game Dev · Stanford",      activity: "Unity workshop",   captured: "10:42 AM",  w: 1600, h: 1067 },
  { id: "IMG_4822", camp: "Game Dev · Stanford",      activity: "Unity workshop",   captured: "10:44 AM",  w: 1600, h: 1067 },
  { id: "IMG_4823", camp: "Robotics · UCLA",          activity: "Lunch — dining",   captured: "12:18 PM",  w: 1600, h: 1067 },
  { id: "IMG_4824", camp: "Robotics · UCLA",          activity: "VEX build lab",    captured: "2:03 PM",   w: 1600, h: 1067 },
  { id: "IMG_4825", camp: "Film · NYU",               activity: "Editing session",  captured: "2:41 PM",   w: 1600, h: 1067 },
  { id: "IMG_4826", camp: "Film · NYU",               activity: "Outdoor shoot",    captured: "3:15 PM",   w: 1600, h: 1067 },
  { id: "IMG_4827", camp: "AI & ML · MIT",            activity: "Demo day rehearsal", captured: "3:48 PM", w: 1600, h: 1067 },
  { id: "IMG_4828", camp: "AI & ML · MIT",            activity: "Team photo",       captured: "4:02 PM",   w: 1600, h: 1067 },
  { id: "IMG_4829", camp: "Roblox · Caltech",         activity: "Free time — rec",  captured: "4:30 PM",   w: 1600, h: 1067 },
  { id: "IMG_4830", camp: "Roblox · Caltech",         activity: "End-of-day wrap",  captured: "5:12 PM",   w: 1600, h: 1067 },
];

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

export const BADGES = [
  { id: "first-10",    name: "First Ten",         desc: "Reviewed your first 10 photos",       earned: true,  earnedOn: "May 29" },
  { id: "streak-7",    name: "Week Warrior",      desc: "7-day review streak",                 earned: true,  earnedOn: "Jun 04" },
  { id: "streak-30",   name: "Camp Counselor",    desc: "30-day review streak",                earned: false, progress: 9, total: 30 },
  { id: "flagged-10",  name: "Sharp Eye",         desc: "Flagged 10 issues the admin confirmed", earned: true, earnedOn: "Jun 06" },
  { id: "tagged-100",  name: "Librarian",         desc: "Tagged 100 photos accurately",        earned: false, progress: 74, total: 100 },
  { id: "night-owl",   name: "Night Owl",         desc: "Reviewed after 10pm, 5 times",        earned: true,  earnedOn: "Jun 02" },
  { id: "perfect-10",  name: "Perfect Batch",     desc: "A full batch of 10 with no flags reversed", earned: false, progress: 0, total: 1 },
  { id: "team-mvp",    name: "Team MVP",          desc: "Top reviewer on your team this week", earned: false, progress: 0, total: 1 },
];

export const RECENT_ACTIVITY = [
  { when: "Just now",     text: "Approved 8 of 10 in a session",         pts: "+82"  },
  { when: "1h ago",       text: "Earned badge: Sharp Eye",                pts: "+50"  },
  { when: "3h ago",       text: "Flagged IMG_4612 — admin confirmed",     pts: "+15"  },
  { when: "Yesterday",    text: "Completed daily streak (day 9)",         pts: "+25"  },
  { when: "Yesterday",    text: "Approved 10 of 10 in a session",         pts: "+100" },
];

export const ADMIN_USERS = [
  { name: "Priya Shah",      email: "priya.s@idtech.com",  role: "Senior Reviewer", team: "Operations", reviewed: 482, pts: 4820, last: "2m ago" },
  { name: "Marcus Webb",     email: "marcus.w@idtech.com", role: "Staff Reviewer",  team: "Programs",   reviewed: 461, pts: 4615, last: "14m ago" },
  { name: "Ana Flores",      email: "ana.f@idtech.com",    role: "Senior Reviewer", team: "Marketing",  reviewed: 441, pts: 4410, last: "1h ago" },
  { name: "Jordan Kim",      email: "jordan.k@idtech.com", role: "Staff Reviewer",  team: "Support",    reviewed: 399, pts: 3990, last: "3h ago" },
  { name: "Riley Turner",    email: "riley.t@idtech.com",  role: "Staff Reviewer",  team: "Programs",   reviewed: 372, pts: 3720, last: "now" },
  { name: "Sam Okafor",      email: "sam.o@idtech.com",    role: "Staff Reviewer",  team: "Programs",   reviewed: 354, pts: 3540, last: "4h ago" },
  { name: "Leo Chen",        email: "leo.c@idtech.com",    role: "Staff Reviewer",  team: "Operations", reviewed: 320, pts: 3200, last: "2d ago" },
  { name: "Mira Patel",      email: "mira.p@idtech.com",   role: "Staff Reviewer",  team: "Marketing",  reviewed: 298, pts: 2980, last: "28m ago" },
  { name: "Dr. Harper Rowe", email: "harper.r@idtech.com", role: "Admin",           team: "—",          reviewed: 0,   pts: 0,    last: "now" },
];

export type FlaggedPhoto = {
  id: string;
  camp: string;
  campLocation: string;
  campWeek: string;
  campWeekDates: string;
  activity: string;
  captured: string;
  capturedDate: string;
  flaggedBy: string;
  flaggedByEmail: string;
  flaggedAt: string;
  flaggedAtRelative: string;
  tags: string[];
  note?: string;
};

export const FLAGGED_PHOTOS: FlaggedPhoto[] = [
  {
    id: "IMG_4612",
    camp: "Game Dev",
    campLocation: "Stanford University, Palo Alto CA",
    campWeek: "Week 3",
    campWeekDates: "Jul 8 – Jul 12, 2026",
    activity: "Unity workshop",
    captured: "2:14 PM",
    capturedDate: "Jul 10, 2026",
    flaggedBy: "Riley Turner",
    flaggedByEmail: "riley.t@idtech.com",
    flaggedAt: "Jul 10, 2026 · 4:31 PM",
    flaggedAtRelative: "12m ago",
    tags: ["gesture", "inappropriate"],
    note: "Camper in back is making a gesture I'm not sure about — could be totally innocent but want a second set of eyes.",
  },
  {
    id: "IMG_4590",
    camp: "Robotics",
    campLocation: "UCLA, Los Angeles CA",
    campWeek: "Week 3",
    campWeekDates: "Jul 8 – Jul 12, 2026",
    activity: "VEX build lab",
    captured: "11:47 AM",
    capturedDate: "Jul 10, 2026",
    flaggedBy: "Marcus Webb",
    flaggedByEmail: "marcus.w@idtech.com",
    flaggedAt: "Jul 10, 2026 · 1:02 PM",
    flaggedAtRelative: "1h ago",
    tags: ["bad-lighting", "bad-expression"],
    note: "Lighting is rough but the moment is great. If you can rescue the exposure it might be worth keeping.",
  },
  {
    id: "IMG_4588",
    camp: "Film",
    campLocation: "NYU, New York NY",
    campWeek: "Week 3",
    campWeekDates: "Jul 8 – Jul 12, 2026",
    activity: "Editing session",
    captured: "10:22 AM",
    capturedDate: "Jul 10, 2026",
    flaggedBy: "Ana Flores",
    flaggedByEmail: "ana.f@idtech.com",
    flaggedAt: "Jul 10, 2026 · 12:18 PM",
    flaggedAtRelative: "2h ago",
    tags: ["minor-ident"],
    note: "Camper's full name visible on the laptop sticker — please blur or skip.",
  },
  {
    id: "IMG_4571",
    camp: "AI & ML",
    campLocation: "MIT, Cambridge MA",
    campWeek: "Week 3",
    campWeekDates: "Jul 8 – Jul 12, 2026",
    activity: "Demo day rehearsal",
    captured: "3:48 PM",
    capturedDate: "Jul 9, 2026",
    flaggedBy: "Priya Shah",
    flaggedByEmail: "priya.s@idtech.com",
    flaggedAt: "Jul 9, 2026 · 5:30 PM",
    flaggedAtRelative: "Yesterday",
    tags: ["duplicate"],
    note: "Looks like a duplicate of IMG_4570 — same group, almost identical framing.",
  },
  {
    id: "IMG_4555",
    camp: "Roblox",
    campLocation: "Caltech, Pasadena CA",
    campWeek: "Week 3",
    campWeekDates: "Jul 8 – Jul 12, 2026",
    activity: "Free time — rec room",
    captured: "4:30 PM",
    capturedDate: "Jul 9, 2026",
    flaggedBy: "Jordan Kim",
    flaggedByEmail: "jordan.k@idtech.com",
    flaggedAt: "Jul 9, 2026 · 6:11 PM",
    flaggedAtRelative: "Yesterday",
    tags: ["consent", "no-faces"],
    note: "Two new arrivals this week — not sure if media releases came in. Faces partially turned but still identifiable.",
  },
  {
    id: "IMG_4540",
    camp: "Creative",
    campLocation: "USC, Los Angeles CA",
    campWeek: "Week 3",
    campWeekDates: "Jul 8 – Jul 12, 2026",
    activity: "Outdoor shoot",
    captured: "1:05 PM",
    capturedDate: "Jul 9, 2026",
    flaggedBy: "Sam Okafor",
    flaggedByEmail: "sam.o@idtech.com",
    flaggedAt: "Jul 9, 2026 · 2:22 PM",
    flaggedAtRelative: "Yesterday",
    tags: ["safety"],
    note: "Camper too close to the stair edge — small thing but worth a look before it goes anywhere.",
  },
  {
    id: "IMG_4521",
    camp: "Game Dev",
    campLocation: "Stanford University, Palo Alto CA",
    campWeek: "Week 2",
    campWeekDates: "Jul 1 – Jul 5, 2026",
    activity: "Lunch — dining hall",
    captured: "12:18 PM",
    capturedDate: "Jul 3, 2026",
    flaggedBy: "Mira Patel",
    flaggedByEmail: "mira.p@idtech.com",
    flaggedAt: "Jul 3, 2026 · 3:00 PM",
    flaggedAtRelative: "Last week",
    tags: ["off-brand", "messy-setup"],
  },
  {
    id: "IMG_4498",
    camp: "Robotics",
    campLocation: "UCLA, Los Angeles CA",
    campWeek: "Week 2",
    campWeekDates: "Jul 1 – Jul 5, 2026",
    activity: "Team photo",
    captured: "4:02 PM",
    capturedDate: "Jul 2, 2026",
    flaggedBy: "Leo Chen",
    flaggedByEmail: "leo.c@idtech.com",
    flaggedAt: "Jul 2, 2026 · 4:55 PM",
    flaggedAtRelative: "Last week",
    tags: ["blurry", "low-quality"],
    note: "Soft focus across the whole frame — phone shake during a long-ish exposure.",
  },
];
