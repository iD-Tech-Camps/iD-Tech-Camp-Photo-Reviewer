# iD Tech Photo Reviewer — Project Context

> **Purpose of this document:** Hand off context to a fresh Claude thread (or any collaborator) so we can pick up work without re-explaining the whole project. Update this whenever the architecture, infrastructure, or roadmap changes.

---

## What this app is

A gamified internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Built as an internal web app, not customer-facing. Used by a known group of employees who sign in with their iD Tech Google Workspace accounts.

Reviewers move through a queue of photos and either **approve** them (share-worthy — rate, optionally tag, +10 pts) or **flag** them (anything that isn't a clear approve — tag what's wrong, optional note, +15 pts). Flagged photos go to a separate **Flag Review** queue handled by Senior Reviewers, who make the final call: accept the photo back into the library, delete it, or download it for an offline conversation with a director.

---

## Current status (as of last working session)

**The reviewer and senior flows are now fully DB-backed, and the Profile + Admin Overview screens read live aggregates. Tags, app settings, points config, the multiplier-bonus schedule, and the example library are all live on Supabase as of May 6, 2026 (sub-steps 7.6a–d, complete).** Step 7 of the roadmap is now fully done (all sub-steps 1–6 landed). What works end-to-end against Supabase:

- Production deployment on Vercel (auto-deploys from `main`)
- Google OAuth login restricted to `@idtech.com` accounts (Internal Workspace)
- `useCurrentUser` reads role from `profiles` (the dev role-switcher is gone)
- Reviewer queue (`ReviewScreen`) reads pending photos from `photos` and writes `reviews` + `review_tags` on each approve/flag
- Senior queue (`FlagReview`) reads flagged photos with the joined hierarchy + flagging reviewer + tag list, and writes accept/delete reviews
- Sidebar Review and Flag-review badges show **live** counts from the DB; HomeScreen subtitle's `{{count}}` is live too
- All four review triggers fire correctly under RLS (see "RLS gotcha" below — this took a fix migration)
- ProfileScreen and AdminOverview both read from `public.reviewer_stats` (a `security_invoker = true` view that joins `profiles` with aggregated `reviews` counts/sums — see migration 15). One row per profile, zero-filled aggregates so consumers don't have to null-coalesce.
- **Tags are now read from the DB.** ReviewScreen pulls positive/negative tags from `public.tags` via `lib/tags.ts → fetchTags`, partitioned by kind via `partitionActiveTags`. FlagReview uses `buildTagLabelLookup` so historical flag rows still render friendly labels even when their tag was later deactivated. Admin → Points & rules → Tag library now reads from the same table and writes new tags / remove (hard delete with FK-aware fallback to `active = false`) directly via Supabase. The old `NEGATIVE_TAGS` / `PHOTO_TAGS` / `negativeTagLabel` exports in `components/data.tsx` are gone.
- **AppSettings live on `app_settings` (migration 16).** The single-row table now covers everything in the runtime `AppSettings` type except `bonusPeriods`: brand_*, the four reviewer-copy strings (greeting / subtitle / completion title + message / empty-queue message), `support_email`, and the appearance triple (`theme` / `accent` / `density`). The dead `show_leaderboard` column from migration 7 was dropped. `SettingsProvider` (`components/settings.tsx`) now hydrates from the DB on mount via `lib/app-settings.ts`, and admin edits go through `updateAppSettings` (optimistic UI, rollback + `saveError` surfaced on failure). The localStorage blob is gone.
- **Points multiplier bonus has its own table now (migration 17).** `bonus_periods` is a multi-row table with the same shape the localStorage `BonusPeriod` had — `mode` discriminates recurring (days[] + HH:MM clock window) vs one-time (timestamptz pair) rows; `multiplier` is `numeric(4,2)` with a 1.10–10.00 check. Admin → Points & rules → Points multiplier bonus now reads/writes through `lib/bonus-periods.ts` via the new `BonusPeriodsProvider` + `useBonusPeriods` hook. Shell.tsx's `useActiveBonusPeriod` reads from the same provider. Mounted from `App.tsx` directly under `SettingsProvider`.
- **`points_config` is read from the DB in ReviewScreen.** `lib/points-config.ts → fetchPointsConfig` lands on mount; `basePointsFor` returns the per-decision base (with a `DEFAULT_POINTS_CONFIG` fallback if the fetch hasn't resolved yet). Approve / Flag buttons + the post-decision toast multiply the base by the active bonus multiplier and the result is now passed verbatim into `submitReview` as `pointsAwarded` — the DB snapshot in `reviews.points_awarded` reflects the bonus the reviewer actually saw. (The trigger keeps its "fall back to points_config" behavior so senior accept/delete decisions, which never run through a bonus pennant, still snapshot correctly.) Admin → Points & rules → Per-action points loads + saves through `updatePointsConfig`.
- **Examples library is fully DB-backed (migration 18, sub-step 7.6b).** `lib/examples.ts` exposes `fetchExamples` / `createExample` / `updateExampleMetadata` / `replaceExampleImage` / `deleteExample` / `reorderExamples`. Image files live in the new `example-images` Supabase Storage bucket (public-read, admin-write at both bucket and object-RLS layers). AdminExamples now wires up upload / edit-metadata / replace-image / delete modals plus drag-and-drop reordering via `@dnd-kit/core` + `@dnd-kit/sortable` (atomic via the `public.reorder_examples` RPC; optimistic UI with rollback on failure). GuideScreen renders the curated images directly (no more `PhotoPlaceholder` fakery there) in the order admins set. The `EXAMPLES` mock constant in `components/data.tsx` is gone; the placeholder seed rows from migration 7 were dropped by migration 18.
- **Admin → Overview now lets admins edit reviewer role + team.** The per-row dots button opens a modal (`ReviewerEditModal` in `Admin.tsx`) with a 3-up role picker and a free-text team field. Saves go through `lib/profile.ts → updateReviewerProfile`, which UPDATEs the `profiles` base table (the `reviewer_stats` view is read-only). Optimistic UI + toast on success/failure, with rollback on error. Self-lockout is prevented client-side: an admin editing their own row can't pick `reviewer`/`senior`. (No new migration — the existing `profiles_update_admin` RLS from migration 9 already permits the writes.)
- 18 migrations applied. **Four** server-side tests still pass after the DB extensions (smoke + reviewer e2e + flag e2e + reviewer_stats); migrations 16–18 didn't disturb the surface they probe.
- **UX cleanups landed (May 6, 2026):** Points Multiplier Bonus schedules (multiplier + days/times, admin-configured) are persisted via `SettingsProvider` and read by both HomeScreen (banner) and ReviewScreen (compact pennant) through the shared `BonusPennant` + `useActiveBonusPeriod` in `Shell.tsx`; both displays show the active window so reviewers know when it ends. The reviewer's `FlagModal` now exposes a "Quarantine" checkbox that flows through `submitReview` to `reviews.quarantine`; the senior queue surfaces the same flag both as a row pill and a rose-themed banner on the detail panel.

**What does NOT work yet:**

- The admin-overview "Active reviewers" denominator currently equals total profiles count; once invitations + idle/inactive transitions land we'll want to filter by `profiles.status`.
- No SmugMug API integration (the placeholder seed data simulates one location/week with 10 photos under "iD Tech Camps → Adelphi University → May 25–29, 2026")
- Outstanding `npm audit` issues (Next.js 14.2.35 has known high-severity advisories; major-version upgrade pending)

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
  data.tsx                # mock constants. Tag exports gone as of 7.6a; EXAMPLES gone as of 7.6b. Still exports PhotoPlaceholder + photoPaletteFor (used elsewhere for decorative gradient stand-ins) and the orphaned SESSION_PHOTOS / FLAGGED_PHOTOS / ADMIN_USERS / BADGES / RECENT_ACTIVITY arrays (no longer consumed by screens; HomeScreen still uses SESSION_PHOTOS for the decorative thumbnail strip, which is purely visual until SmugMug data lands in step 8).
  settings.tsx            # Two providers + helpers. SettingsProvider / useSettings backs the singleton AppSettings (branding, reviewer copy, appearance, supportEmail) — DB-backed via lib/app-settings.ts as of 7.6c. BonusPeriodsProvider / useBonusPeriods backs the multiplier-bonus list — DB-backed via lib/bonus-periods.ts as of 7.6d. Also exports activeBonusPeriod / formatBonusWindow / formatBonusMultiplier / fillTemplate.
  BrowserWindow.tsx       # ported from prototype, currently orphaned
  screens/
    HomeScreen.tsx        # uses live pendingCount from App.tsx
    ReviewScreen.tsx      # DB-backed approve/flag flow
    LeaderboardProfileGuide.tsx  # ProfileScreen reads live `reviewer_stats` (career stats, decision breakdown, activity card); GuideScreen reads the live `examples` library (lib/examples.ts → fetchExamples) and renders real images from Supabase Storage.
    Admin.tsx             # admin sub-screens. Overview reads live `reviewer_stats` and admins can edit any reviewer's role + team via the per-row dots button (writes through lib/profile.ts → updateReviewerProfile; self-demotion guarded). Points/TagLibrary/BonusEvents/Settings/Examples are all DB-backed. Examples uses `lib/examples.ts` + Supabase Storage and ships with @dnd-kit drag-and-drop reordering plus modal-based upload/edit/replace/delete.
    FlagReview.tsx        # DB-backed senior queue
lib/
  current-user.tsx        # UserProvider, useCurrentUser, Role type, ROLE_LABEL. Reads role + id from profiles.
  reviews.ts              # fetchPendingPhotos, fetchPendingCount, fetchFlaggedPhotos, fetchFlaggedCount, submitReview
  profile.ts              # fetchMyStats (single-row), fetchReviewerRoster (full table) — backed by `reviewer_stats` view. Plus updateReviewerProfile (admin-only role/team edits, writes to the `profiles` base table under the existing `profiles_update_admin` RLS).
  tags.ts                 # fetchTags, partitionActiveTags, buildTagLabelLookup, createTag, setTagActive, deleteTag, slugifyTagId. Backs ReviewScreen, FlagReview, and AdminTagLibrary.
  app-settings.ts         # fetchAppSettings, updateAppSettings — single-row config (brand_*, reviewer copy, appearance, support_email). Backs SettingsProvider.
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
  migrations/             # 18 SQL migrations applied to the work-account project (see SCHEMA_SPEC.md for the table)
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
| 8 | SmugMug API integration | Pending |
| 9 | Next.js security upgrade (resolves audit warnings) | Pending |
| 10 | Polish + team rollout | Pending |

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
- **Points Multiplier Bonus is fully DB-backed (migration 17).** `bonus_periods` is its own multi-row table; `BonusPeriodsProvider` (in `components/settings.tsx`) hydrates from the DB on mount and exposes optimistic `create` / `update` / `remove` / `toggle` methods. Shell.tsx's `useActiveBonusPeriod()` + `BonusPennant` reads from that provider and re-evaluates on a 30s tick so windows start/end mid-session correctly. ReviewScreen now passes an explicit `pointsAwarded = base × multiplier` into `submitReview`, so `reviews.points_awarded` snapshots the bonused value rather than the base. The trigger keeps its "fall back to points_config" path so non-bonused decisions (senior accept / delete on FlagReview) still snapshot correctly.
- **Admin Overview merged with Users.** One screen showing the reviewer roster with per-user stats (reviewed, points, last active, role, team), plus a small `Reviewed today` / `Active reviewers` stat row above the table. The old operational stat cards, "Queue depth by camp" panel, and "Flagged for review" snippet are gone. The standalone Users screen is gone too — its search + Invite buttons live on the merged Overview header. The queue-depth panel is deferred until SmugMug data is wired in step 8.

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


