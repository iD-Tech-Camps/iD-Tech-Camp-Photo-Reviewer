# iD Tech Photo Reviewer — Project Context

> **Purpose of this document:** Hand off context to a fresh thread (or any collaborator) so we can pick up work without re-explaining the whole project. Update this whenever the architecture, infrastructure, or roadmap changes.

---

## What this app is

A gamified internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Built as an internal web app, not customer-facing. Used by a known group of employees who sign in with their iD Tech Google Workspace accounts.

Reviewers move through a queue of photos and either **approve** them (share-worthy — rate, optionally tag, +10 pts) or **flag** them (anything that isn't a clear approve — tag what's wrong, optional note, +15 pts). Flagged photos go to a separate **Flag Review** queue handled by Senior Reviewers, who make the final call: accept the photo back into the library, delete it, or download it for an offline conversation with a director.

---

## Where we are

Step 7 (Supabase persistence) is complete. The reviewer + senior flows, tags, examples, points, multiplier-bonus schedule, app settings, branding favicon, and per-user theme are all DB-backed under RLS. 20 migrations applied to the work-account Supabase project.

**Active phase: step 8 — SmugMug API integration.** Everything below feeds into that.

### What works end-to-end
- Production deployment on Vercel (auto-deploys from `main`); Google OAuth gated to `@idtech.com` via Workspace Internal app.
- `useCurrentUser` reads role + theme + id from `profiles`. Theme is per-user; `data-theme` on `<html>` flips with `useUpdateTheme`. The dev role-switcher is gone.
- Reviewer queue (`ReviewScreen`) reads pending photos and writes `reviews` + `review_tags`. The Approve/Flag buttons multiply the per-decision base from `points_config` by the active bonus multiplier and pass the result to `submitReview` as `pointsAwarded`, so `reviews.points_awarded` snapshots the bonused value the reviewer actually saw. The flag modal exposes a Quarantine checkbox that flows through to `reviews.quarantine`.
- Senior queue (`FlagReview`) joins photos + hierarchy + flagging reviewer + tags; accept/delete decisions write reviews. Quarantine surfaces as both a row pill and a rose banner on the detail panel.
- Sidebar Review and Flag-review badges, HomeScreen subtitle `{count}` template, and the bonus pennant (HomeScreen banner + ReviewScreen header) all read live.
- ProfileScreen + Admin Overview both read from `public.reviewer_stats` (security-invoker view joining `profiles` with aggregated `reviews`; one row per profile, zero-filled aggregates). Admin Overview can edit any reviewer's role + team via a modal that writes through `lib/profile.ts → updateReviewerProfile` (RLS via `profiles_update_admin`); self-lockout is prevented client-side. ProfileScreen has its own Appearance card with the per-user theme picker.
- All four review triggers fire correctly under RLS (see "RLS gotcha" below).

### What does NOT work yet
- **No SmugMug API integration.** The placeholder seed simulates one location/week with 10 photos under "iD Tech Camps → Adelphi University → May 25–29, 2026". → **step 8** (the active phase).
- The `Admin → SmugMug import` screen is a static placeholder shell (added in 7.7f); step 8 makes it real.
- Admin Overview "Active reviewers" denominator equals total profile count (no `profiles.status` filter). → **step 11** (idle/inactive transitions).
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
  layout.tsx              # root layout, loads Google Fonts + legacy.css. generateMetadata reads brand_name/brand_tagline + favicon_storage_path from app_settings.
  page.tsx                # renders <App />
  globals.css             # tailwind directives only
  login/page.tsx          # Google sign-in screen
  auth/callback/route.ts  # OAuth callback handler
components/
  App.tsx                 # root client component, role-gated screen routing; owns the live pendingCount fetch. Applies data-theme from useCurrentUser, --sun accent from useSettings.
  Shell.tsx               # Sidebar (live Review + Flag-review badges, role-aware nav), PageHeader, fireConfetti, useToast
  Icon.tsx                # inline SVG icon set
  data.tsx                # Gradient stand-in renderer: PhotoPlaceholder + photoPaletteFor (used by HomeScreen, ReviewScreen, FlagReview as a placeholder until real SmugMug thumbnails land in step 8).
  settings.tsx            # Two providers + helpers. SettingsProvider / useSettings backs the singleton AppSettings (branding, reviewer copy, accent, supportEmail, faviconStoragePath) — DB-backed via lib/app-settings.ts. BonusPeriodsProvider / useBonusPeriods backs the multiplier-bonus list — DB-backed via lib/bonus-periods.ts. Also exports activeBonusPeriod / formatBonusWindow / formatBonusMultiplier / fillTemplate.
  screens/
    HomeScreen.tsx        # uses live pendingCount from App.tsx
    ReviewScreen.tsx      # DB-backed approve/flag flow
    LeaderboardProfileGuide.tsx  # ProfileScreen reads live `reviewer_stats` (career stats, decision breakdown, activity card) and has the per-user theme picker. GuideScreen reads the live `examples` library and renders real images from Supabase Storage.
    Admin.tsx              # admin sub-screens. Overview reads live `reviewer_stats` and admins can edit any reviewer's role + team via the per-row dots button (writes through lib/profile.ts → updateReviewerProfile; self-demotion guarded). Points / TagLibrary / BonusEvents / Examples / Settings are all DB-backed. SmugMugImport is currently a static placeholder; step 8 wires it up.
    FlagReview.tsx         # DB-backed senior queue
lib/
  current-user.tsx        # UserProvider, useCurrentUser, useUpdateTheme, Role + Theme types, ROLE_LABEL. Reads role + theme from profiles. The setter writes through the existing profiles_update_self RLS policy.
  reviews.ts              # fetchPendingPhotos, fetchPendingCount, fetchFlaggedPhotos, fetchFlaggedCount, submitReview
  profile.ts              # fetchMyStats, fetchReviewerRoster, updateReviewerProfile — backed by `reviewer_stats` view. Admin role/team writes go to the `profiles` base table under `profiles_update_admin`.
  tags.ts                 # fetchTags, partitionActiveTags, buildTagLabelLookup, createTag, setTagActive, deleteTag, slugifyTagId. Backs ReviewScreen, FlagReview, and AdminTagLibrary.
  app-settings.ts         # fetchAppSettings, updateAppSettings — single-row config (brand_*, reviewer copy, accent, support_email, favicon_storage_path). Plus uploadFavicon / removeFavicon (Supabase Storage round-trips for the branding-assets bucket) and a brandingAssetUrl resolver. Backs SettingsProvider.
  points-config.ts        # fetchPointsConfig, updatePointsConfig, basePointsFor, DEFAULT_POINTS_CONFIG. Backs ReviewScreen + AdminPoints.
  bonus-periods.ts        # fetchBonusPeriods, createBonusPeriod, updateBonusPeriod, deleteBonusPeriod, setBonusPeriodEnabled. Backs BonusPeriodsProvider, which Shell.tsx + AdminPoints both consume.
  examples.ts             # fetchExamples, createExample, updateExampleMetadata, replaceExampleImage, deleteExample, reorderExamples. Owns the Supabase Storage round-trips for the example-images bucket. Backs AdminExamples + GuideScreen.
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
    e2e_reviewer_stats.sql      # reviewer_stats view shape + delta assertions; runs under role=authenticated
  .temp/                  # gitignored — Supabase CLI cache (project-ref, pooler URL, version metadata)
spec/
  PROJECT_CONTEXT.md      # this file
  SCHEMA_SPEC.md          # database design + post-implementation notes
```

### Roles and access

Three roles, matching the Postgres `role` enum exactly:

| Role | UI label | Sees | Notes |
|---|---|---|---|
| `reviewer` | "Staff Reviewer" | Review, Profile, Guide | Default for any signed-in user (set by `handle_new_user` trigger) |
| `senior` | "Senior Reviewer" | Everything a reviewer sees, plus **Flag review** | Reviews photos that regular reviewers flagged |
| `admin` | "Admin" | Everything, plus the **Admin** section | Full control |

`Role` in `lib/current-user.tsx` matches the DB enum (`reviewer`, `senior`, `admin`). The friendly label "Staff Reviewer" is preserved in `ROLE_LABEL.reviewer`. Role assignment is read from `profiles.role` after sign-in. **Admin → Overview** lets admins edit any reviewer's role + team via the per-row dots button (modal posts through `lib/profile.ts → updateReviewerProfile` against the `profiles_update_admin` RLS policy from migration 9). The form refuses to demote the currently-signed-in admin out of the admin role to prevent self-lockout; recovery for the truly-stuck case is still a SQL edit on `profiles`.

---

## Infrastructure references

> All keys/passwords are NOT stored in this doc. They live in Vercel env vars, `.env.local` (gitignored), and a password manager.

| Resource | Location | Notes |
|---|---|---|
| **Production URL** | `https://id-tech-camp-photo-reviewer.vercel.app` | Public URL, but middleware redirects unauthenticated users to `/login` |
| **GitHub repo** | `iD-Tech-Camps/iD-Tech-Camp-Photo-Reviewer` (work GitHub org) | Originally on a personal account; transferred to the work org. The local `origin` remote was updated on 2026-05-05 to the new canonical URL. |
| **Vercel project** | Personal Vercel account, connected to the work-org GitHub repo | Auto-deploys on push to `main` |
| **Supabase project** | Work-account Supabase, project ID stored separately | Hosts the schema plus two public-read / admin-write Storage buckets: `example-images` (admin example library) and `branding-assets` (favicon today). |
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
| 6 | MVP scope refactor | ✅ Done |
| 7 | Replace `localStorage` with Supabase persistence | ✅ Done |
| 8 | **SmugMug API integration** — admin-curated import pool with folder priority (not full auto-ingest) | 🟡 Active |
| 9 | Next.js security upgrade (resolves audit warnings) | Pending |
| 10 | Polish + team rollout | Pending |
| 11 | **Notifications** — in-app + email transport, senior routing rules, idle/inactive transitions | Pending |

---

### Step 8 — SmugMug API integration

**V1 model: admin-curated import pool, not full auto-ingest.** Admins pick which SmugMug folders (typically a `camp_week`, possibly a whole `location`) to bring into the review queue rather than the import job pulling everything. Folders carry a priority order — photos from higher-priority folders fill the queue first, so when there's an active need ("we really need to clear MIT this week"), admins move that folder to the top. The `Admin → SmugMug import` nav entry is the screen this work fleshes out; today it's a static placeholder.

Likely shape:
- A new `import_pool` table — rows of `(camp_week_id, display_order, added_by, added_at)`. Drag-to-reorder mirroring the `examples.display_order` pattern.
- The `SmugMugImport` admin screen lets admins browse the SmugMug folder tree, add/remove folders, and reorder.
- The reviewer queue (`fetchPendingPhotos`) sorts by pool priority before falling back to oldest-first within a tier.
- The import job (scheduled or admin-triggered) only pulls photos from folders in the pool. The placeholder seed (`smugmug_*_id like 'placeholder-%'`) gets cleared on first real run.
- The `quarantine` mechanism wires its missing piece here: `photos.is_quarantined` already flips on flag insert via trigger, but the actual SmugMug API call to move the file to the hidden folder is what step 8 adds.

**Open questions for when we get there:**
- Removing a folder from the pool — existing reviews stay (immutable log), but what about photos already imported and not yet reviewed? Drop from the queue, or leave?
- Pool granularity — `camp_week` only, or also `location` for a whole-location pull?
- Refresh cadence — manual button vs. cron, and whether refresh re-walks already-imported folders for new uploads.
- Whether priority is folder-level (whole folder before next folder) or interleaved (round-robin across active folders).

---

### Step 11 — Notifications

Deferred from V1 because none of it has a working backbone yet.

- **Notifications infrastructure** — `notifications` table for in-app delivery (bell icon in sidebar + notifications screen); email transport via Resend or SendGrid through a Supabase Edge Function; `notification_preferences` per user (opt-out per channel and per kind).
- **Senior routing rules UI** — wire the `senior_routing_rules` table (already in the schema, migration 8) to a real admin screen. Tag triggers come from the live `tags` table; recipient is any `senior` or `admin` profile. Channels are filtered to whatever's actually wired (probably email + in-app on day one even though the schema permits slack/sms).
- **`profile_status` transitions** — wire the `active | idle | inactive` enum currently unused on `profiles`. Cron or trigger flips status based on `last_active_at`. Admin Overview's "Active reviewers" denominator filters by status instead of total profile count.

No invitations, no auto-reassign / batch-assignment work — both removed from the roadmap. Any signed-in `@idtech.com` Google account becomes a reviewer automatically via the `handle_new_user` trigger.

---

## Working style / preferences

- Update the spec files and README as we work.
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
- **Two-decision review flow: approve or flag (no reject).** A flag is not a final decision; a senior reviewer accepts, deletes, or escalates. This is the workflow the schema models.
- **Three roles, not two.** `reviewer` / `senior` / `admin`. Senior exists specifically to handle flagged photos — keeps regular reviewers from being final arbiters on edge cases.
- **`camp_weeks.is_active` is a view, not a stored generated column.** Postgres requires stored generated columns to use `IMMUTABLE` expressions; `current_date` is `STABLE`, so the original spec definition was rejected on push. The boolean is exposed through `public.camp_weeks_with_status`. App code reads the view when it wants the flag; writes still go to the base table. Don't try to add it back as a column without picking up the immutability constraint.
- **Schema migrations live under `supabase/migrations/`; no `supabase init` was run.** No `config.toml`, no `seed.sql`. The repo is linked via `npx supabase link`; CLI cache lives in `supabase/.temp/` (gitignored). Use `npx supabase db push` to apply, `npx supabase db query --file ... --linked` to verify.
- **Year folders inside SmugMug locations are not modeled.** SmugMug nests `Location → Year (2025/2026) → Camp Week`; our schema goes `Location → Camp Week` directly. Year is recoverable from `camp_weeks.starts_on`. The SmugMug import job (step 8) walks year folders as a pass-through layer.
- **Review trigger functions are `SECURITY DEFINER`.** They run as the function owner so the inner UPDATEs on `photos` / `profiles` aren't filtered by the caller's RLS context. Anytime you write a trigger that mutates an RLS-protected table, mark it `security definer set search_path = public` or it'll fail silently in production. See the RLS gotcha below for the bug this fixes.
- **`Role` enum in code uses `reviewer` (not `staff`).** The DB enum is `('reviewer', 'senior', 'admin')`; the code matches it. The friendly label "Staff Reviewer" is preserved in `ROLE_LABEL.reviewer`.
- **No runtime feature toggles in V1.** Confetti is always on; leaderboard / streaks are deferred to a post-V1 release. The multiplier-bonus pennant *is* on, but it's data-driven (off when no bonus is enabled and active) — not a global feature flag.
- **Points Multiplier Bonus is fully DB-backed.** `bonus_periods` is its own multi-row table — `mode` discriminates recurring (days[] + HH:MM clock window) vs. one-time (timestamptz pair); `multiplier` is `numeric(4,2)` with a 1.10–10.00 check. The reviewer client passes an explicit `pointsAwarded = base × multiplier` into `submitReview` so `reviews.points_awarded` snapshots the bonused value the reviewer saw. The trigger's `points_config` lookup is the fallback for non-bonused write paths (senior accept / delete on FlagReview). Pennant re-evaluates on a 30s tick so windows start/end mid-session.
- **Theme is per-user; accent stays global; density removed.** `profiles.theme` (`('light','dark')` CHECK) backs the per-user picker on the Profile screen. `app_settings.accent` is the brand color, set by admins on Admin → Settings. Density was never wired (no `data-density` attribute, no compact CSS rules) — wiring it well isn't worth the work for an internal tool.
- **Admin Overview merged with Users.** One screen showing the reviewer roster with per-user stats (reviewed, points, last active, role, team), plus a small `Reviewed today` / `Active reviewers` stat row above the table. The standalone Users screen is gone — its search lives on the merged Overview header. The queue-depth panel is deferred until SmugMug data is wired in step 8.
- **Team is free-text on `profiles.team`.** Normalize to a `teams` table only if/when teams need to drive routing. There's no autocomplete affordance — admins type the value directly.
- **No invitations.** Workspace OAuth already gates sign-in to `@idtech.com`; the `handle_new_user` trigger creates the profile on first login. There is no invite link, no `pending_invites` table, no pre-assigned role/team.
- **No assignment / batch / auto-reassign system.** The original AdminAssignment screen was a mock that persisted nothing. Step 7.7f refactored it into a `SmugMugImport` placeholder shell (admin-only) that step 8 will flesh out. Reviewer queue ordering is global — no per-user batch slicing, no idle reassignment.
- **SmugMug ingest is admin-curated in V1, not full auto-ingest.** Admins pick which folders enter the review queue and prioritize them. Full design in step 8.

---

## Known issues / gotchas to remember

- **The RLS-vs-trigger gotcha (resolved).** Trigger functions on `reviews` originally ran as the invoker. Their inner `UPDATE public.photos SET current_status = ...` was silently zero-rowed because `photos` has only a SELECT policy for authenticated users (writes are reserved for the import job via service role). Reviews inserted, but the photo status never moved. **Migration 14 marks all four review trigger functions `security definer set search_path = public`.** This matches the pattern already used by `is_admin()`, `is_senior_or_admin()`, and `handle_new_user()`. Anytime you write a trigger that mutates an RLS-protected table, mark it `security definer` or it'll fail silently in production.
- **The smoke-test gotcha that hid the bug above.** `supabase db query` defaults to running as the service role, which **bypasses RLS entirely**. The schema-level smoke test never noticed the trigger UPDATE was being filtered. The e2e tests now `set local role authenticated` and pin `request.jwt.claims to '{"sub": "<your uid>", "role": "authenticated"}'` so RLS is enforced as in production. Keep that pattern for new tests; don't write new client-flow tests as the service role.
- **Theme has a brief light-mode flash on cold loads.** `data-theme` stays `light` until the profile fetch resolves, so dark-mode users see ~few-hundred-ms of light flash on first paint. Acceptable for an internal app; SSR-injecting the theme would mean reading Supabase from the server layout and isn't worth it.
- **Browsers cache favicons aggressively.** After an admin replaces the favicon on Admin → Settings, reviewers may need to hard-refresh before they see the new icon. The replacement code already lands at a fresh storage path so the URL changes, but some browsers still cache by host.
- **`npm audit` reports 4 high-severity issues in Next.js 14.x.** The fix is a major-version upgrade (14 → 16). Deferred until after core features are working. **Don't run `npm audit fix --force`** — it will break the project mid-development.
- **Pre-existing build warning:** `no-page-custom-font` in `app/layout.tsx`. Cosmetic only. Google Fonts are loaded via `<link>` rather than `next/font` to preserve the existing CSS font stacks unchanged.
- **Vercel does not follow GitHub redirects.** If the repo is moved/transferred again in the future, the Vercel project must be manually reconnected to the new repo location. (Same for the local `origin` remote URL — that was updated to the new canonical work-org URL on 2026-05-05.)
- **Tag deletes can soft-fail (by design).** `review_tags.tag_id → tags.id` is `on delete restrict`, so once a tag has ever been used on a flag/approve, hard-deleting it raises `23503`. The Admin TagLibrary catches that and falls back to flipping `active = false`, which hides the tag from the review modals while keeping historical labels intact via `buildTagLabelLookup` (which includes inactive rows). If you ever need to bulk-purge truly unused tags, hitting the DB with `delete from public.tags where active = false and id not in (select tag_id from public.review_tags)` is safe.
- **Placeholder seed data is keyed by an obvious prefix.** All the placeholder rows seeded by migration 13 (4 divisions, 1 location, 1 camp week, 10 photos) use `smugmug_*_id` values that start with `placeholder-`. The SmugMug import job (step 8) should `update ... where smugmug_*_id like 'placeholder-%'` to swap in real ids — or `delete` them outright before the first real import.
- **Smoke test gotchas (for anyone editing `supabase/tests/*.sql`).**
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
