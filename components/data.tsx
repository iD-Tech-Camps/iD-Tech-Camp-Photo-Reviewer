"use client";

import React from "react";

export const REJECT_REASONS = [
  { id: "blurry",         label: "Blurry / out of focus" },
  { id: "bad-expression", label: "Bad expression" },
  { id: "bad-lighting",   label: "Bad lighting" },
  { id: "messy-setup",    label: "Messy background" },
  { id: "no-faces",       label: "No faces / camper not visible" },
  { id: "duplicate",      label: "Duplicate shot" },
  { id: "off-brand",      label: "Off-brand / not camp context" },
  { id: "low-quality",    label: "Technical issue (resolution, crop)" },
];

export const FLAG_REASONS = [
  { id: "inappropriate",  label: "Possibly inappropriate" },
  { id: "gesture",        label: "Questionable gesture" },
  { id: "consent",        label: "Consent / media release unclear" },
  { id: "minor-ident",    label: "Identifying info visible" },
  { id: "second-opinion", label: "Want a second opinion" },
  { id: "safety",         label: "Safety concern" },
];

export const PHOTO_TAGS = [
  { id: "blurry",        label: "Blurry",              color: "rose" },
  { id: "bad-expression",label: "Bad expression",      color: "rose" },
  { id: "messy-setup",   label: "Messy setup",         color: "rose" },
  { id: "bad-lighting",  label: "Bad lighting",        color: "rose" },
  { id: "no-faces",      label: "No faces visible",    color: "rose" },
  { id: "inappropriate", label: "Inappropriate",       color: "rose" },
  { id: "duplicate",     label: "Duplicate",           color: "rose" },
  { id: "great-moment",  label: "Great moment",        color: "moss" },
  { id: "hero-shot",     label: "Hero shot",           color: "sun"  },
  { id: "group-energy",  label: "Group energy",        color: "lake" },
  { id: "caption-worthy",label: "Caption-worthy",      color: "sun"  },
];

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

export const LEADERBOARD = [
  { rank: 1,  name: "Priya Shah",      team: "Operations",      pts: 4820, streak: 18, reviews: 482, you: false },
  { rank: 2,  name: "Marcus Webb",     team: "Programs",        pts: 4615, streak: 12, reviews: 461, you: false },
  { rank: 3,  name: "Ana Flores",      team: "Marketing",       pts: 4410, streak: 21, reviews: 441, you: false },
  { rank: 4,  name: "Jordan Kim",      team: "Support",         pts: 3990, streak: 7,  reviews: 399, you: false },
  { rank: 5,  name: "You — Riley T.",  team: "Programs",        pts: 3720, streak: 9,  reviews: 372, you: true  },
  { rank: 6,  name: "Sam Okafor",      team: "Programs",        pts: 3540, streak: 4,  reviews: 354, you: false },
  { rank: 7,  name: "Leo Chen",        team: "Operations",      pts: 3200, streak: 2,  reviews: 320, you: false },
  { rank: 8,  name: "Mira Patel",      team: "Marketing",       pts: 2980, streak: 11, reviews: 298, you: false },
  { rank: 9,  name: "Tomás Ruiz",      team: "Curriculum",      pts: 2710, streak: 5,  reviews: 271, you: false },
  { rank: 10, name: "Harper Lee",      team: "Support",         pts: 2440, streak: 3,  reviews: 244, you: false },
];

export const TEAMS = [
  { name: "Operations",  pts: 12540, members: 14 },
  { name: "Programs",    pts: 11870, members: 12 },
  { name: "Marketing",   pts: 11250, members: 11 },
  { name: "Support",     pts: 10410, members: 13 },
  { name: "Curriculum",  pts: 9630,  members: 10 },
];

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

export const EXAMPLES = {
  good: [
    { id: "EX_G01", label: "Eye contact, engaged", note: "Subjects looking at camera or clearly focused on activity." },
    { id: "EX_G02", label: "Hero shot",             note: "Clear subject, good framing, strong moment." },
    { id: "EX_G03", label: "Group energy",          note: "Natural group interaction, multiple faces visible." },
    { id: "EX_G04", label: "Activity context",      note: "Shows what camp is actually about. Backdrop reads." },
  ],
  bad: [
    { id: "EX_B01", label: "Blurry",                note: "Motion or focus blur that obscures faces." },
    { id: "EX_B02", label: "Bad expression",        note: "Mid-blink, mid-chew, or uncomfortable looking." },
    { id: "EX_B03", label: "Messy setup",           note: "Distracting clutter, trash, disorganized space." },
    { id: "EX_B04", label: "Bad lighting",          note: "Harsh shadows, blown highlights, or too dark." },
    { id: "EX_B05", label: "Inappropriate gesture", note: "Any gesture or pose that shouldn't go to parents." },
  ],
};

export const ADMIN_USERS = [
  { name: "Priya Shah",      email: "priya.s@idtech.com",  role: "Reviewer", team: "Operations", status: "Active",   last: "2m ago" },
  { name: "Marcus Webb",     email: "marcus.w@idtech.com", role: "Reviewer", team: "Programs",   status: "Active",   last: "14m ago" },
  { name: "Ana Flores",      email: "ana.f@idtech.com",    role: "Lead",     team: "Marketing",  status: "Active",   last: "1h ago" },
  { name: "Jordan Kim",      email: "jordan.k@idtech.com", role: "Reviewer", team: "Support",    status: "Active",   last: "3h ago" },
  { name: "Riley Turner",    email: "riley.t@idtech.com",  role: "Reviewer", team: "Programs",   status: "Active",   last: "now" },
  { name: "Sam Okafor",      email: "sam.o@idtech.com",    role: "Reviewer", team: "Programs",   status: "Active",   last: "4h ago" },
  { name: "Leo Chen",        email: "leo.c@idtech.com",    role: "Reviewer", team: "Operations", status: "Idle",     last: "2d ago" },
  { name: "Mira Patel",      email: "mira.p@idtech.com",   role: "Reviewer", team: "Marketing",  status: "Active",   last: "28m ago" },
  { name: "Dr. Harper Rowe", email: "harper.r@idtech.com", role: "Admin",    team: "—",         status: "Active",   last: "now" },
];
