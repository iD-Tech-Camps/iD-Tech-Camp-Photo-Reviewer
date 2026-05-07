# iD Tech Photo Reviewer — Project Context

> **Purpose of this document:** Hand off context to a fresh Claude thread (or any collaborator) so we can pick up work without re-explaining the whole project. Update this whenever the architecture, infrastructure, or roadmap changes.

---

## What this app is

A gamified internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Built as an internal web app, not customer-facing. Used by a known group of employees who sign in with their iD Tech Google Workspace accounts.

Reviewers move through a queue of photos and either **approve** them (share-worthy — rate, optionally tag, +10 pts) or **flag** them (anything that isn't a clear approve — tag what's wrong, optional note, +15 pts). Flagged photos go to a separate **Flag Review** queue handled by Senior Reviewers, who make the final call: accept the photo back into the library, delete it, or download it for an offline conversation with a director.

---

## Current status (as of last working session)

**Step 7 (Supabase persistence) is fully done as of May 6, 2026 — all sub-steps 7.1–7.6 landed, with 7.6a–d shipping same day.** The reviewer and senior flows are entirely DB-backed; tags, app settings, `points_config`, the multiplier-bonus schedule, and the examples library all live on Supabase. **Step 7.7 (pre-SmugMug cleanup) is the active phase — 3 of 6 sub-pieces done (7.7a + 7.7b + 7.7c). 7.7d, e, or f next (any order).**

What works end-to-end against Supabase:

- Production deployment on Vercel (auto-deploys from `main`); Google OAuth gated to `@idtech.com` via Workspace Internal app.
- `useCurrentUser` reads role + id from `profiles`; the dev role-switcher is gone.
- Reviewer queue (`ReviewScreen`) reads pending photos and writes `reviews` + `review_tags`. Approve/Flag buttons multiply the per-decision base from `points_config` by the active bonus multiplier and pass the result to `submitReview` as `pointsAwarded`, so `reviews.points_awarded` snapshots the bonused value the reviewer actually saw. The flag modal exposes a Quarantine checkbox that flows through to `reviews.quarantine`.
- Senior queue (`FlagReview`) joins photos + hierarchy + flagging reviewer + tags; accept/delete decisions write reviews. Quarantine surfaces as both a row pill and a rose banner on the detail panel.
- Sidebar Review and Flag-review badges, HomeScreen subtitle `{{count}}` template, and the bonus pennant (HomeScreen banner + ReviewScreen header) all read live.
- ProfileScreen + Admin Overview both read from `public.reviewer_stats` (security-invoker view joining `profiles` with aggregated `reviews`; one row per profile, zero-filled aggregates). Admin Overview can edit any reviewer's role + team via a modal that writes through `lib/profile.ts → updateReviewerProfile` (RLS via `profiles_update_admin`); self-lockout is prevented client-side.
- ProfileScreen also has an Appearance card with a per-user theme picker (`profiles.theme`, 7.7c). `lib/current-user.tsx → useUpdateTheme` is the writer; the optimistic update writes through the existing `profiles_update_self` RLS policy (theme isn't in the with-check restricted column list, so self-edits pass). `App.tsx` reads the theme off `useCurrentUser` and applies `data-theme` on `<html>`.
- All four review triggers fire correctly under RLS (security definer — see RLS gotcha below).
- 20 migrations applied. Four server-side tests still pass under their pinned roles: `smoke_test.sql` + three e2e files (reviewer, flag-review, reviewer_stats).

**What does NOT work yet (with the step that addresses each):**

- Self-service profile editing (display name, team) is missing; currently only admins can edit profiles via the Overview modal. → **7.7d**
- Invite button on Admin → Overview is a no-op. → **7.7e** (share-link modal + team `<datalist>` autocomplete reusing existing `profiles.team` values).
- AdminAssignment screen is fully mock — batch settings, auto-reassign, reminders, FlagNotifications, save buttons all persist nothing. → **7.7f** hides it from the nav; **step 11** rebuilds it.
- Admin Overview "Active reviewers" denominator equals total profile count (no `profiles.status` filter). → **step 11** (idle/inactive transitions).
- No SmugMug API integration. The placeholder seed simulates one location/week with 10 photos under "iD Tech Camps → Adelphi University → May 25–29, 2026". → **step 8**.
- `npm audit` reports 4 high-severity issues in Next.js 14.x; major-version upgrade pending. → **step 9**.

---

## Tech stack

- **Framework:** Next.js 14 (App Router) + TypeScript + Tailwind (installed but mostly unused — legacy CSS is the source of truth for visual styling)
- **Hosting:** Vercel (auto-deploys on push to `main`)
- **Database + Auth:** Supabase (Postgres + Google OAuth via `@supabase/ssr`)
- **OAuth provider:** Google Cloud (Internal Workspace app)
- **Local dev:** Node 18+, `npm run dev` on `localhost:3000`

### Key project structure

```
app/
  layout.tsx              # root layout, loads Google Fonts + legacy.css
  page.tsx                # renders <App />
  globals.css             # tailwind directives only
  login/page.tsx          # Google sign-in screen
  auth/callback/route.ts  # OAuth callback handler
components/
  App.tsx                 # root client component, role-gated screen routing; owns the live pendingCount fetch
  Shell.tsx               # Sidebar (live Review + Flag-review badges, role-aware nav), PageHeader, fireConfetti, useToast
  Icon.tsx                # inline SVG icon set
  data.tsx                # Now just the gradient stand-in renderer: exports PhotoPlaceholder + photoPaletteFor (consumed by HomeScreen, ReviewScreen, FlagReview as a placeholder until real SmugMug thumbnails land in step 8). All prototype mock constants (SESSION_PHOTOS / FLAGGED_PHOTOS / ADMIN_USERS / BADGES / RECENT_ACTIVITY / NEGATIVE_TAGS / PHOTO_TAGS / EXAMPLES) and the FlaggedPhoto type were removed in 7.7b.
  settings.tsx            # Two providers + helpers. SettingsProvider / useSettings backs the singleton AppSettings (branding, reviewer copy, brand color/accent, supportEmail) — DB-backed via lib/app-settings.ts as of 7.6c. Theme is no longer here as of 7.7c — it's per-user and lives on `useCurrentUser`; density was dropped entirely. BonusPeriodsProvider / useBonusPeriods backs the multiplier-bonus list — DB-backed via lib/bonus-periods.ts as of 7.6d. Also exports activeBonusPeriod / formatBonusWindow / formatBonusMultiplier / fillTemplate.
  screens/
    HomeScreen.tsx        # uses live pendingCount from App.tsx
    ReviewScreen.tsx      # DB-backed approve/flag flow
    LeaderboardProfileGuide.tsx  # ProfileScreen reads live `reviewer_stats` (career stats, decision breakdown, activity card); GuideScreen reads the live `examples` library (lib/examples.ts → fetchExamples) and renders real images from Supabase Storage.
    Admin.tsx             # admin sub-screens. Overview reads live `reviewer_stats` and admins can edit any reviewer's role + team via the per-row dots button (writes through lib/profile.ts → updateReviewerProfile; self-demotion guarded). Points/TagLibrary/BonusEvents/Settings/Examples are all DB-backed. Examples uses `lib/examples.ts` + Supabase Storage and ships with @dnd-kit drag-and-drop reordering plus modal-based upload/edit/replace/delete.
    FlagReview.tsx        # DB-backed senior queue
lib/
  current-user.tsx        # UserProvider, useCurrentUser, useUpdateTheme, Role + Theme types, ROLE_LABEL. Reads role + theme + id from profiles. The setter writes through the existing `profiles_update_self` RLS policy (theme isn't in the policy's with-check restricted columns, so self-edits pass without any extra policy work).
  reviews.ts              # fetchPendingPhotos, fetchPendingCount, fetchFlaggedPhotos, fetchFlaggedCount, submitReview
  profile.ts              # fetchMyStats (single-row), fetchReviewerRoster (full table) — backed by `reviewer_stats` view. Plus updateReviewerProfile (admin-only role/team edits, writes to the `profiles` base table under the existing `profiles_update_admin` RLS).
  tags.ts                 # fetchTags, partitionActiveTags, buildTagLabelLookup, createTag, setTagActive, deleteTag, slugifyTagId. Backs ReviewScreen, FlagReview, and AdminTagLibrary.
  app-settings.ts         # fetchAppSettings, updateAppSettings — single-row config (brand_*, reviewer copy, accent, support_email, favicon_storage_path). Theme + density columns were dropped from app_settings in 7.7c — theme is per-user (profiles.theme) and density was never wired. Plus uploadFavicon / removeFavicon (Supabase Storage round-trips for the branding-assets bucket, same upload-then-update-row-then-cleanup-old order lib/examples.ts uses) and a brandingAssetUrl resolver. Backs SettingsProvider's setFavicon method.
  points-config.ts        # fetchPointsConfig, updatePointsConfig, basePointsFor, DEFAULT_POINTS_CONFIG. Backs ReviewScreen (read for points_awarded calc) + AdminPoints (read/write).
  bonus-periods.ts        # fetchBonusPeriods, createBonusPeriod, updateBonusPeriod, deleteBonusPeriod, setBonusPeriodEnabled. Backs BonusPeriodsProvider, which Shell.tsx + AdminPoints both consume.
  examples.ts             # fetchExamples, createExample, updateExampleMetadata, replaceExampleImage, deleteExample, reorderExamples. Owns the Supabase Storage round-trips (upload + cleanup-on-error, public URL resolution via the SDK) for the example-images bucket. Backs AdminExamples + GuideScreen.
  supabase/
    client.ts             # browser client (createBrowserClient)
    server.ts             # server client (createServerClient with cookies)
    middleware.ts         # session refresh + auth-gating logic
middleware.ts             # root middleware, delegates to lib/supabase/middleware.ts
styles/legacy.css         # ~650 lines, source of truth for visual styling
supabase/
  migrations/             # 20 SQL migrations applied to the work-account project (see SCHEMA_SPEC.md for the table)
  tests/
    smoke_test.sql              # schema-level smoke; runs as service role
    e2e_review_flow.sql         # reviewer flow end-to-end; runs under role=authenticated with pinned JWT
    e2e_flag_review_flow.sql    # senior flow + the FlagReview join shape; runs under role=authenticated
  .temp/                  # gitignored — Supabase CLI cache (project-ref, pooler URL, version metadata)
spec/
  PROJECT_CONTEXT.md      # this file
  SCHEMA_SPEC.md          # database design + post-implementation notes
```

### Roles and access

Three roles, matching the Postgres `role` enum exactly:

| Role | UI label | Sees | Notes |
|---|---|---|---|
| `reviewer` | "Staff Reviewer" | Review, Leaderboard, Profile, Guide | Default for any signed-in user (set by `handle_new_user` trigger) |
| `senior` | "Senior Reviewer" | Everything a reviewer sees, plus **Flag review** | Reviews photos that regular reviewers flagged |
| `admin` | "Admin" | Everything, plus the **Admin** section | Full control |

`Role` in `lib/current-user.tsx` was renamed from `staff` to `reviewer` to match the DB enum. The user-facing label "Staff Reviewer" is preserved in `ROLE_LABEL.reviewer`. Role assignment is read from `profiles.role` after sign-in. **Admin → Overview** now lets admins edit any reviewer's role + team via the per-row dots button (modal posts through `lib/profile.ts → updateReviewerProfile` against the `profiles_update_admin` RLS policy from migration 9). The form refuses to demote the currently-signed-in admin out of the admin role to prevent self-lockout; recovery for the truly-stuck case is still a SQL edit on `profiles`.

---

## Infrastructure references

> All keys/passwords are NOT stored in this doc. They live in Vercel env vars, `.env.local` (gitignored), and a password manager.

| Resource | Location | Notes |
|---|---|---|
| **Production URL** | `https://id-tech-camp-photo-reviewer.vercel.app` | Public URL, but middleware redirects unauthenticated users to `/login` |
| **GitHub repo** | `iD-Tech-Camps/iD-Tech-Camp-Photo-Reviewer` (work GitHub org) | Was originally on personal account; transferred to work org. The local `origin` remote was updated 2026-05-05 to the new canonical URL. |
| **Vercel project** | Personal Vercel account, connected to the new GitHub repo location | Auto-deploys on push to `main` |
| **Supabase project** | Work-account Supabase, project ID stored separately | Old personal-account Supabase project should be deleted/paused. As of 7.6b also hosts the `example-images` Storage bucket (public-read, admin-write at both bucket and `storage.objects` RLS layers). |
| **Google Cloud project** | Personal Google account, project name "iD Photo Reviewer" | Internal Workspace app — only `@idtech.com` accounts can complete OAuth. Acceptable to leave on personal account; transferable later if needed. |

**Environment variables in use:**
- `NEXT_PUBLIC_SUPABASE_URL` — public Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase publishable key (the new `sb_publishable_...` format, stored under the legacy variable name for SDK compatibility)

Both set in Vercel (all environments) and in `.env.local` for local dev.

**Supabase URL configuration (already set):**
- Site URL: `https://id-tech-camp-photo-reviewer.vercel.app`
- Redirect URLs: `https://id-tech-camp-photo-reviewer.vercel.app/**` and `http://localhost:3000/**`

---

## Roadmap

| # | Step | Status |
|---|---|---|
| 1 | Convert prototype to Next.js | ✅ Done |
| 2 | Push to GitHub | ✅ Done |
| 3 | Deploy to Vercel | ✅ Done |
| 4 | Supabase + Google OAuth | ✅ Done |
| 5 | Database schema design | ✅ Done |
| 6 | **MVP scope refactor** — remove feature toggles, defer leaderboard/streaks/multiplier-bonus/accuracy, merge Admin Overview + Users | 🟡 In progress |
| 7 | Replace `localStorage` with Supabase persistence | ✅ Done |
| 7.7 | **Pre-SmugMug cleanup pass** — wiring sweep + drop dead UI before new feature work piles on | 🟡 In progress (3 / 6 sub-pieces — 7.7d/e/f remaining) |
| 8 | **SmugMug API integration** — admin-curated import pool with folder priority (not full auto-ingest) | Pending |
| 9 | Next.js security upgrade (resolves audit warnings) | Pending |
| 10 | Polish + team rollout | Pending |
| 11 | **Notifications, assignment & invitations** — email + in-app, senior routing rules, idle/inactive transitions, pre-assigned invites | Pending |

### Step 7 sub-steps (resume here)

| # | Sub-step | Status | Landed in |
|---|---|---|---|
| 7.1 | Read role from `profiles` (drop dev role switcher) | ✅ Done | `dc1f644` |
| 7.2 | Seed `photos` from `SESSION_PHOTOS` (with division/location/week chain) | ✅ Done | `4e5bca3`, migration 13 |
| 7.3 | Wire `ReviewScreen` to insert real `reviews` + `review_tags` | ✅ Done | `431bcd2` |
| 7.4 | Wire `FlagReview` senior actions + sidebar live count | ✅ Done | `a955aa2`, fix in `740780d` (migration 14) |
| 7.5 | Move points / profile reads off mock data onto live `reviews` aggregates; same for the merged Admin Overview roster | ✅ Done | migration 15 (`reviewer_stats` view), `lib/profile.ts`, third e2e test |
| 7.6 | Read `tags` / `examples` / `points_config` / `app_settings` (incl. multiplier-bonus schedule) from DB | ✅ Done (4 / 4 pieces) | — |

**Step 7.6 sub-pieces** (tackled one at a time per the working-style rule):

| # | Piece | Status | Landed in |
|---|---|---|---|
| 7.6a | Tags — wire ReviewScreen / FlagReview / AdminTagLibrary to the live `tags` table via `lib/tags.ts`; drop NEGATIVE_TAGS / PHOTO_TAGS / negativeTagLabel | ✅ Done | 2026-05-06 |
| 7.6b | Examples — wire GuideScreen + AdminExamples to the live `examples` table backed by Supabase Storage. Migration 18 added `examples.storage_path`, the `example-images` bucket + RLS, and the `public.reorder_examples` RPC. New `lib/examples.ts` owns all reads/writes including upload-with-cleanup-on-error. AdminExamples got upload / edit-metadata / replace-image / delete modals plus `@dnd-kit` drag-reorder. GuideScreen renders real images. | ✅ Done | 2026-05-06 |
| 7.6c | App settings — migration 16 added `home_greeting` / `home_subtitle` / `completion_title` / `completion_message` / `empty_queue_message` / `support_email` / `theme` / `accent` / `density` to `app_settings` and dropped the dead `show_leaderboard`. `lib/app-settings.ts` is the SettingsProvider's source of truth; AdminSettings debounces text input writes (500ms idle + flush on blur) to avoid hammering the DB. | ✅ Done | 2026-05-06 |
| 7.6d | Points & bonus — `lib/points-config.ts` reads/writes the singleton row; ReviewScreen passes an explicit `pointsAwarded = base × multiplier` into `submitReview` so the DB snapshot reflects the bonus the reviewer saw. Migration 17 added the `bonus_periods` table; `lib/bonus-periods.ts` + `BonusPeriodsProvider` (in `components/settings.tsx`) replace the localStorage schedule. AdminPoints loads + saves both. | ✅ Done | 2026-05-06 |

**Step 7.7 sub-pieces** (pre-SmugMug cleanup, tackled one at a time):

| # | Piece | Status | Notes |
|---|---|---|---|
| 7.7a | Favicon + SSR title from `app_settings` | ✅ Done | 2026-05-06. **Favicon is admin-uploaded, not auto-generated.** Migration 19 added `app_settings.favicon_storage_path` (nullable) + a public-read / admin-write `branding-assets` Storage bucket (with the same dual-layer storage.objects RLS pattern migration 18 used for `example-images`). `lib/app-settings.ts` exposes `uploadFavicon` / `removeFavicon` (upload-then-update-row-then-cleanup-old order, mirroring `lib/examples.ts → replaceExampleImage`) plus a `brandingAssetUrl` resolver. `SettingsProvider` exposes a dedicated `setFavicon(file \| null)` method so favicon writes don't ride the regular `update()` path; `reset()` preserves the uploaded asset. Admin → Settings has a new Favicon card (PNG only, 1 MB cap, preview + Replace/Remove buttons). `app/layout.tsx → generateMetadata` reads `favicon_storage_path` and emits `<link rel="icon">` only when it's set; otherwise no icon link is rendered (browsers fall back to their generic icon). The SSR title joins `brand_name` + `brand_tagline` with the same logic the runtime override in `App.tsx` uses (`name && tag ? "name · tag" : name || tag || "iD Tech Photo Reviewer"`); on RLS / no-session failures both title and favicon use the bare fallbacks. **Caveat:** browsers cache favicons aggressively — admin replacements may need a hard refresh before reviewers see the new icon. |
| 7.7b | Delete orphaned mocks + `BrowserWindow.tsx` | ✅ Done | 2026-05-06. `components/data.tsx` now only exports `PhotoPlaceholder` + `photoPaletteFor` (the gradient stand-in renderer, still consumed by HomeScreen / ReviewScreen / FlagReview). `BrowserWindow.tsx` deleted. HomeScreen's decorative thumbnail strip now uses an inline `HERO_THUMB_IDS` array (10 ids, one per palette) instead of importing `SESSION_PHOTOS`; the strip stays purely visual until step 8 wires real SmugMug thumbnails. |
| 7.7c | Theme → per-user, drop density, relocate appearance UI | ✅ Done | 2026-05-07. Migration 20 added `profiles.theme` (`text not null default 'light'` + `profiles_theme_chk` ∈ `('light','dark')`) and dropped `app_settings.theme` / `app_settings.density` plus their named CHECKs. `lib/current-user.tsx` now selects `role, theme` from `profiles` and exposes `useUpdateTheme()` — an optimistic writer that goes through the existing `profiles_update_self` RLS policy (theme isn't in the with-check restricted column list, so self-edits pass without policy changes). `components/App.tsx` applies `data-theme` from `useCurrentUser()` instead of `settings`. The Appearance card was removed from Admin → Settings; the accent picker moved into its own "Brand color" card on the same screen (worded as a brand decision now since it's the only global appearance knob left). ProfileScreen got a new Appearance card on the right column with the light/dark toggle. Density is gone everywhere — runtime, DB, UI. **Caveat:** the `data-theme` attribute briefly stays `light` until the profile fetch resolves, so cold loads show a few hundred ms of light-mode flash for dark-mode users. Acceptable for an internal app; SSR-injecting the theme would require reading Supabase from the server layout and isn't worth it. |
| 7.7d | Self-service profile editing | Pending | Profile screen gets a small "Edit" affordance for display name + team. RLS already permits a user to update their own row's display fields (migration 9). Either reuse `lib/profile.ts → updateReviewerProfile` or add a thin self-edit variant. |
| 7.7e | Invite share-link modal + team `<datalist>` autocomplete | Pending | Replace the dead Invite button on Admin → Overview with a modal: production URL + copy-to-clipboard + one-line note that any `@idtech.com` Google account can sign in. Separately, the team input in `ReviewerEditModal` gets a `<datalist>` populated from `select distinct team from profiles where team is not null and team <> ''`. No schema change. Pre-assigned invites (a `pending_invites` table keyed on email) are deferred to step 11. |
| 7.7f | Hide AdminAssignment from nav | Pending | Drop the nav entry in `Shell.tsx`'s `adminItems` and remove the screen from `App.tsx`'s routing + the `ADMIN_SCREENS` set. The component file can stay — step 11 rewrites most of it. The `senior_routing_rules` table stays untouched in the DB (consumed by step 11). |

---

### Step 8 — SmugMug API integration (preview)

**V1 model: admin-curated import pool, not full auto-ingest.** Admins pick which SmugMug folders (typically a `camp_week`, possibly a whole `location`) to bring into the review queue rather than the import job pulling everything. Folders carry a priority order — photos from higher-priority folders fill the queue first, so when there's an active need ("we really need to clear MIT this week"), admins move that folder to the top.

Likely shape:
- A new `import_pool` table — rows of `(camp_week_id, display_order, added_by, added_at)`. Drag-to-reorder mirroring the `examples.display_order` pattern.
- An admin screen (or a card on Overview) that lets admins browse the SmugMug folder tree, add/remove folders, and reorder.
- The reviewer queue (`fetchPendingPhotos`) sorts by pool priority before falling back to oldest-first within a tier.
- The import job (scheduled or admin-triggered) only pulls photos from folders in the pool. The placeholder seed (`smugmug_*_id like 'placeholder-%'`) gets cleared on first real run.
- The `quarantine` mechanism wires its missing piece here: `photos.is_quarantined` already flips on flag insert via trigger, but the actual SmugMug API call to move the file to the hidden folder is what step 8 adds.

**Open questions for when we get there:**
- Removing a folder from the pool — existing reviews stay (immutable log), but what about photos already imported and not yet reviewed? Drop from the queue, or leave?
- Pool granularity — `camp_week` only, or also `location` for a whole-location pull?
- Refresh cadence — manual button vs. cron, and whether refresh re-walks already-imported folders for new uploads.
- Whether priority is folder-level (whole folder before next folder) or interleaved (round-robin across active folders).

---
### Step 11 — Notifications, assignment & invitations

Bundle of related work deferred from V1 because none of it has a working backbone yet. Restoring AdminAssignment to the nav happens here.

- **Notifications infrastructure** — `notifications` table for in-app delivery (bell icon in sidebar + notifications screen); email transport via Resend or SendGrid through a Supabase Edge Function; `notification_preferences` per user (opt-out per channel and per kind).
- **Senior routing rules UI** — wire the `senior_routing_rules` table (migration 8 — already in the schema) to a real admin screen. Tag triggers from the live `tags` table; recipient is any `senior` or `admin` profile. Channels filtered to whatever's actually wired (probably email + in-app on day one even though the schema permits slack/sms).
- **Reminders / nudges** — revive Admin → Assignment with real persistence. Per-user idle threshold + channel choice. Probably a daily cron that finds reviewers where `now() - last_active_at > threshold`.
- **Invitations** — `pending_invites` table keyed on email so admins can pre-assign role/team before someone signs in. The `handle_new_user` trigger consumes the invite on first OAuth login.
- **`profile_status` transitions** — wire the `active | idle | inactive` enum currently unused on `profiles`. Cron or trigger flips status based on `last_active_at`. Admin Overview's "Active reviewers" denominator filters by status instead of total profile count.
- **Auto-reassign** — the AdminAssignment "Auto-reassign after N minutes" idea may or may not survive contact with the import-pool model from step 8. Decide here.
---

## Working style / preferences

- Update the /spec files and readme file as we work.

Here's what's been useful:

- **One step at a time.** Big plans are nice but get overwhelming. Concrete next action > comprehensive theory.
- **Explain the *why*, not just the *what*.** When suggesting an action, briefly say what it does and why it matters.
- **Be honest about uncertainty.** OAuth flows, deployment configs, RLS-vs-trigger interactions, and DNS-adjacent things often fail on the first try. Warn the user, don't oversell.

---

## Decisions already made (don't relitigate without reason)

- **Hosting on Vercel, not WordPress plugin.** WordPress was considered (would have lived inside an existing internal site, idemailwiz.com) but rejected — wrong tool for a React/gamified UI, plus access-control concerns.
- **Default Vercel `*.vercel.app` URL is fine for now.** Custom subdomain via company DNS deferred to avoid blocking on engineering team. Cheap standalone domain remains an option.
- **Domain restriction enforced at Google Workspace layer (Internal OAuth app), not in app code.** No need for explicit email checks in middleware.
- **`strict: false` TypeScript.** Loose typing during prototype port; can tighten later.
- **Tailwind installed but not actively used.** Legacy CSS (`styles/legacy.css`) is the source of truth for visual styling. Available for new components.
- **`use client` on basically everything.** This app is fully interactive; not optimizing for server components right now. Acceptable tradeoff for an internal tool.
- **Two-decision review flow: approve or flag (no reject).** Reject was removed in favor of a flag → senior-review handoff. A flag is not a final decision; a senior reviewer accepts, deletes, or escalates. This is the workflow the schema needs to model.
- **Three roles, not two.** `reviewer` / `senior` / `admin`. Senior exists specifically to handle flagged photos — keeps regular reviewers from being final arbiters on edge cases.
- **`camp_weeks.is_active` is a view, not a stored generated column.** Postgres requires stored generated columns to use `IMMUTABLE` expressions; `current_date` is `STABLE`, so the original spec definition was rejected on push. The boolean is exposed through `public.camp_weeks_with_status`. App code reads the view when it wants the flag; writes still go to the base table. Don't try to add it back as a column without picking up the immutability constraint.
- **Schema migrations live under `supabase/migrations/`; no `supabase init` was run.** No `config.toml`, no `seed.sql`, no functions templates. The repo is linked via `npx supabase link`; CLI cache lives in `supabase/.temp/` (gitignored). Use `npx supabase db push` to apply, `npx supabase db query --file ... --linked` to verify.
- **Year folders inside SmugMug locations are not modeled in the schema.** SmugMug nests `Location → Year (2025/2026) → Camp Week`; our schema goes `Location → Camp Week` directly. Year is recoverable from `camp_weeks.starts_on`. The SmugMug import job (step 8) walks year folders as a pass-through layer.
- **Review trigger functions are `SECURITY DEFINER`.** Originally they were invoker-rights and got silently zero-rowed by RLS on real client inserts (see "RLS gotcha" below). Migration 14 fixes this and the e2e tests now pin `role=authenticated` so the regression can't sneak past us again.
- **`Role` enum in code uses `reviewer` (not `staff`).** The DB enum is `('reviewer', 'senior', 'admin')`; the code matches it. The friendly label "Staff Reviewer" is preserved in `ROLE_LABEL.reviewer`.
- **No runtime feature toggles in V1.** Leaderboard and streaks are deferred to a post-V1 release; confetti is always on. Feature availability is controlled by versioning, not admin-facing switches. The four removed `AppSettings` keys (`confettiOnComplete`, `showLeaderboard`, `showStreaks`, `showDoublePoints`) are gone from the type, defaults, and every consumer; pre-existing values in `localStorage` are silently ignored by the spread merge. The multiplier-bonus pennant *is* back as of May 6, 2026, but it's data-driven (off when no bonus is enabled and active) — not a global feature flag.
- **Points Multiplier Bonus is fully DB-backed (migration 17).** `bonus_periods` is its own multi-row table — `mode` discriminates recurring (days[] + HH:MM clock window) vs. one-time (timestamptz pair); `multiplier` is `numeric(4,2)` with a 1.10–10.00 check. The reviewer client passes an explicit `pointsAwarded = base × multiplier` into `submitReview` so `reviews.points_awarded` snapshots the bonused value the reviewer saw. The trigger's `points_config` lookup is the fallback for non-bonused write paths (senior accept / delete on FlagReview). Pennant re-evaluates on a 30s tick so windows start/end mid-session.
- **Admin Overview merged with Users.** One screen showing the reviewer roster with per-user stats (reviewed, points, last active, role, team), plus a small `Reviewed today` / `Active reviewers` stat row above the table. The old operational stat cards, "Queue depth by camp" panel, and "Flagged for review" snippet are gone. The standalone Users screen is gone too — its search + Invite buttons live on the merged Overview header. The queue-depth panel is deferred until SmugMug data is wired in step 8.
- **Theme is per-user; accent stays global; density removed.** Theme moves from `app_settings.theme` to a new `profiles.theme` column (same `('light','dark')` CHECK). Accent (`--sun`) stays on `app_settings` as the brand color. Density was never wired (no `data-density` attribute, no compact CSS rules) — wiring it well isn't worth the work for an internal tool. Appearance UI moves from Admin → Settings to the Profile screen. Lands in step 7.7c.
- **Invite is a share-link modal in V1.** Workspace OAuth already gates sign-in to `@idtech.com`; the `handle_new_user` trigger creates the profile on first login. The Invite button just shows the URL + copy + a one-liner. Pre-assignment via `pending_invites` is deferred to step 11.
- **Team stays free-text with `<datalist>` autocomplete.** Reuses existing values from `select distinct team from profiles`. Normalize to a `teams` table only if/when teams need to drive routing.
- **AdminAssignment is hidden from the nav until step 11.** The whole screen (batch settings, auto-reassign, reminders, FlagNotifications, Save/Discard) is mock UI persisting nothing. `senior_routing_rules` stays in the schema; the screen returns when notifications have a real backbone.
- **SmugMug ingest is admin-curated in V1, not full auto-ingest.** Admins pick which folders enter the review queue and prioritize them. Full design in step 8.

---

## Known issues / gotchas to remember

- **The RLS-vs-trigger gotcha (resolved).** Trigger functions on `reviews` originally ran as the invoker. Their inner `UPDATE public.photos SET current_status = ...` was silently zero-rowed because `photos` has only a SELECT policy for authenticated users (writes are reserved for the import job via service role). Reviews inserted, but the photo status never moved. **Migration 14 marks all four review trigger functions `security definer set search_path = public`.** This matches the pattern already used by `is_admin()`, `is_senior_or_admin()`, and `handle_new_user()`. Anytime you write a trigger that mutates an RLS-protected table, mark it `security definer` or it'll fail silently in production.
- **The smoke-test gotcha that hid the bug above.** `supabase db query` defaults to running as the service role, which **bypasses RLS entirely**. The schema-level smoke test never noticed the trigger UPDATE was being filtered. The e2e tests now `set local role authenticated` and pin `request.jwt.claims to '{"sub": "<your uid>", "role": "authenticated"}'` so RLS is enforced as in production. Keep that pattern for new tests; don't write new client-flow tests as the service role.
- **`npm audit` reports 4 high-severity issues in Next.js 14.x.** The fix is a major-version upgrade (14 → 16). Deferred until after core features are working. **Don't run `npm audit fix --force`** — it will break the project mid-development.
- **Pre-existing build warning:** `no-page-custom-font` in `app/layout.tsx`. Cosmetic only. Google Fonts are loaded via `<link>` rather than `next/font` to preserve the existing CSS font stacks unchanged.
- **Vercel does not follow GitHub redirects.** If the repo is moved/transferred again in the future, the Vercel project must be manually reconnected to the new repo location. (Same for the local `origin` remote URL — that was updated to the new canonical work-org URL on 2026-05-05.)
- **Tag deletes can soft-fail (by design).** `review_tags.tag_id → tags.id` is `on delete restrict`, so once a tag has ever been used on a flag/approve, hard-deleting it raises `23503`. The Admin TagLibrary catches that and falls back to flipping `active = false`, which hides the tag from the review modals while keeping historical labels intact via `buildTagLabelLookup` (which includes inactive rows). If you ever need to bulk-purge truly unused tags, hitting the DB with `delete from public.tags where active = false and id not in (select tag_id from public.review_tags)` is safe.
- **Placeholder seed data is keyed by an obvious prefix.** All the placeholder rows seeded by migration 13 (4 divisions, 1 location, 1 camp week, 10 photos) use `smugmug_*_id` values that start with `placeholder-`. The SmugMug import job (step 8) should `update ... where smugmug_*_id like 'placeholder-%'` to swap in real ids — or `delete` them outright before the first real import.
- **Smoke test gotchas (for anyone editing `supabase/tests/smoke_test.sql`).** These also apply to the e2e tests:
  - `set local session_replication_role = replica;` skips FK enforcement *and every user-defined trigger* in the same transaction. The four review triggers are exactly what the tests are meant to verify, so don't reach for that setting. Drop the FK temporarily inside the transaction instead — DDL is transactional in Postgres, so the trailing `rollback;` restores it automatically.
  - Inside one transaction, `now()` returns the transaction's start time, identical for every row inserted in that script. `order by created_at desc limit 1` is therefore non-deterministic when more than one review exists. Filter by `decision` (or another distinguishing column) instead.

---

## Testing

Four files live under `supabase/tests/`. None of them are migrations — they're hand-run.

| File | Role context | What it covers |
|---|---|---|
| `smoke_test.sql` | service role (default) | Schema-level: enums, hierarchy FKs, trigger basics, both check constraints |
| `e2e_review_flow.sql` | `authenticated` + pinned JWT | Reviewer flow: approve + flag, all four triggers, both check constraints, RLS context as in production |
| `e2e_flag_review_flow.sql` | `authenticated` + pinned JWT | Senior flow: flag transition, the FlagReview join shape, accept-after-flag, delete |
| `e2e_reviewer_stats.sql` | `authenticated` + pinned JWT | `reviewer_stats` view shape + delta assertions: row-count parity with `profiles`, no NULL aggregates, totals/decisions/points/today bump correctly on review insert |

Run any of them with:

```bash
npx supabase db query --file supabase/tests/<file>.sql --linked
```

The last row of each is a sentinel string (`smoke test passed`, `e2e review flow passed`, `flag review flow passed`, `reviewer stats view passed`). Anything else is a failure — the `do $$ ... raise exception ... $$` blocks will surface the assertion that broke.

To reset the dev queue between manual UI tests:

```sql
delete from public.review_tags
where review_id in (
  select r.id from public.reviews r
  join public.photos p on p.id = r.photo_id
  where p.smugmug_image_id like 'placeholder-%'
);
delete from public.reviews
where photo_id in (
  select id from public.photos where smugmug_image_id like 'placeholder-%'
);
update public.photos
set current_status = 'pending', is_quarantined = false
where smugmug_image_id like 'placeholder-%';
```


