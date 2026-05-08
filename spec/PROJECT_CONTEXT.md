# iD Tech Photo Reviewer — Project Context

> **Purpose of this document:** Hand off context to a fresh thread (or any collaborator) so we can pick up work without re-explaining the whole project. Update this whenever the architecture, infrastructure, or roadmap changes. For *what the app does* from a user's perspective, see [`README.md`](../README.md). For the database design, see [`SCHEMA_SPEC.md`](./SCHEMA_SPEC.md).

---

## What this app is

A gamified internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Built as an internal web app, not customer-facing. Used by a known group of employees who sign in with their iD Tech Google Workspace accounts.

Reviewers move through a queue of photos and either **approve** them (share-worthy — rate, optionally tag, +10 pts) or **flag** them (anything that isn't a clear approve — tag what's wrong, optional note, +15 pts). Flagged photos go to a separate **Flag Review** queue handled by Senior Reviewers, who make the final call: accept the photo back into the library, delete it, or download it for an offline conversation with a director.

---

## Where we are

Step 7 (Supabase persistence) is complete. The reviewer + senior flows, tags, examples, points, multiplier-bonus schedule, app settings, branding favicon, and per-user theme are all DB-backed under RLS. 25 migrations applied to the work-account Supabase project.

**Step 8 — SmugMug API integration — is complete.** All eight substeps shipped:

- **8.1** — `lib/smugmug/`: OAuth 1.0a-signed fetch wrapper + typed Node/Album/Image helpers. `/api/smugmug/ping` is the admin-gated smoke endpoint.
- **8.2** — Migration 21 added `smugmug_config` (singleton), `photos.priority` (with partial composite index), and `sync_log` (audit trail with `sync_kind` / `sync_status` enums). See SCHEMA_SPEC.
- **8.3** — Migration 22 added `divisions.synced`. `/api/smugmug/sync-folders` (GET = discovery, POST = apply) reconciles SmugMug folders into `divisions / locations / camp_weeks`. The walker uses bounded concurrency (5 + 5), matches by `smugmug_folder_id` first then by normalized name, and skips retired-location subtrees ("Historical Locations" / "Past Locations" etc.). The deep apply gates on `synced = true`.
- **8.4** — `/api/smugmug/sync-now` (admin-session) and `/api/smugmug/sync-scheduled` (CRON_SECRET-bearer, wired to a daily Vercel Cron in `vercel.json`) both delegate to `lib/smugmug/sync/photos.ts → runPhotoSync`. Reconciliation: match by `smugmug_image_id` and update on drift; cross-week match handles re-parenting; missing-from-SmugMug rows with no reviews get DELETE'd, reviewed rows stay forever.
- **8.5** — `Admin → SmugMug import` is the operational dashboard. Lifted into [components/screens/AdminSmugMug.tsx](../components/screens/AdminSmugMug.tsx). Settings card with edit modal (mode-switch save path swaps to a 3-button keep/clear/cancel dialog when there are unreviewed pending photos), actions row (Sync now + Prioritize in queue), paginated queue list, sync-log table. Two new admin handlers back it: `/api/smugmug/prioritize` and `/api/smugmug/clear-pending`. Reviewer queue ordering also wired here: `priority desc, captured_at <queueOrder>` via `lib/reviews.ts → fetchPendingPhotos`.
- **8.6** — Real SmugMug image rendering. The prototype-era `PhotoPlaceholder` is gone; replaced by [components/PhotoImg.tsx](../components/PhotoImg.tsx) — a single shared `<img>` renderer with skeleton, onError fallback, and `loading="lazy"` on grid views. The FlagReview "Download" button now `fetch()`-es the real SmugMug URL.
- **8.7** — Quarantine via `Image.Hidden`. The `reviews_update_quarantine` trigger maintains `photos.is_quarantined`; the SmugMug-side side effect is a single PATCH `/api/v2/image/<imageKey>` with `{ Hidden: true|false }`. [lib/smugmug/quarantine.ts](../lib/smugmug/quarantine.ts) → `setImageHidden`; [lib/smugmug/sync/quarantine.ts](../lib/smugmug/sync/quarantine.ts) → `runQuarantineReconcile`. Client wiring is fire-and-forget through [lib/quarantine-trigger.ts](../lib/quarantine-trigger.ts) — the reviewer never blocks on the SmugMug round-trip; failures land as `quarantine_move` / `failed` rows on `sync_log`. Senior delete on a quarantined photo is a noop on the SmugMug side (the image stays Hidden=true until manually cleaned up).
- **8.8** — Tests + seed cleanup. New `supabase/tests/e2e_smugmug_sync_flow.sql` covers six DB-contract scenarios (clean-slate, no-op re-run, orphan handling, re-parenting, queue ordering, clear-the-queue). Migration 25 dropped the placeholder photos / week / location seeded by migration 13; the four placeholder *divisions* stay because the 8.3 folder sync rewrites their ids in place. The other three e2e tests now self-seed fixtures inside the begin/rollback instead of depending on placeholder seed data.

**Deferred to V2:** A `smugmug_observations` table that the nightly sync appends to (one row per photo ever seen, with first/last seen timestamps + camp_week_id at the time) — unlocks "what did we miss in summer 2024" reporting that survives SmugMug's own reorganization of historical photos. For V1, the same question is answerable with degraded fidelity by comparing SmugMug's current state against reviews.

### What works end-to-end
- Production deployment on Vercel (auto-deploys from `main`); Google OAuth gated to `@idtech.com` via Workspace Internal app.
- `useCurrentUser` reads role + theme + id from `profiles`. Theme is per-user; `data-theme` on `<html>` flips with `useUpdateTheme`. The dev role-switcher is gone.
- Reviewer queue (`ReviewScreen`) reads pending photos and writes `reviews` + `review_tags`. The Approve/Flag buttons multiply the per-decision base from `points_config` by the active bonus multiplier and pass the result to `submitReview` as `pointsAwarded`, so `reviews.points_awarded` snapshots the bonused value the reviewer actually saw. The flag modal exposes a Quarantine checkbox that flows through to `reviews.quarantine`.
- Senior queue (`FlagReview`) joins photos + hierarchy + flagging reviewer + tags; accept/delete decisions write reviews. Quarantine surfaces as both a row pill and a rose banner on the detail panel.
- Sidebar Review and Flag-review badges, HomeScreen subtitle `{count}` template, and the bonus pennant (HomeScreen banner + ReviewScreen header) all read live.
- ProfileScreen + Admin Overview both read from `public.reviewer_stats` (security-invoker view). Admin Overview can edit any reviewer's role + team via a modal (`profiles_update_admin`); self-lockout is prevented client-side. ProfileScreen has its own Appearance card with the per-user theme picker.
- All four review triggers fire correctly under RLS (see "RLS gotcha" below).
- SmugMug ingest is fully wired: scheduled cron sync, manual sync, folder-tree reconcile, prioritize-in-queue, clear-the-queue, and per-photo quarantine via `Image.Hidden`.

### What does NOT work yet
- Admin Overview "Active reviewers" denominator equals total profile count (no `profiles.status` filter). → **step 11** — wired alongside the `profile_status` idle/inactive transitions in the notifications-backbone step.

---

## Tech stack

- **Framework:** Next.js 15.5.x (App Router, on the `backport` LTS line) + React 19 + TypeScript + Tailwind (installed but mostly unused — legacy CSS is the source of truth for visual styling)
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
  api/smugmug/
    ping/route.ts         # admin-only smoke endpoint; hits SmugMug !authuser and returns the nickname so we can verify creds + signing without touching the DB
    sync-folders/route.ts # admin-only folder-tree sync (GET = discovery, POST = apply; ?division=<nodeId> for deep apply gated on synced=true). maxDuration=300.
    sync-now/route.ts     # manual photo-sync (POST, admin-session-gated). Records the admin's id on sync_log.triggered_by; delegates to runPhotoSync.
    sync-scheduled/route.ts # scheduled photo-sync (GET, CRON_SECRET-bearer-gated). Wired to vercel.json's daily 0 8 * * * UTC cron.
    prioritize/route.ts   # "Prioritize in queue" (POST, admin-session-gated). Body { scope, id }; bulk-flips photos.priority=1 on pending rows under the resolved subtree.
    clear-pending/route.ts # mode-switch reset (POST, admin-session-gated). Deletes every pending photo with no reviews history (chunked at 1000 ids per DELETE).
    quarantine/route.ts   # quarantine endpoint (POST, any-authenticated). Body { photoId }. Delegates to runQuarantineReconcile under service role; PATCHes Image.Hidden; writes a quarantine_move sync_log row. Always returns 200.
components/
  App.tsx                 # root client component, role-gated screen routing; owns the live pendingCount fetch. Applies data-theme from useCurrentUser, --sun accent from useSettings.
  Shell.tsx               # Sidebar (live Review + Flag-review badges, role-aware nav), PageHeader, fireConfetti, useToast
  Icon.tsx                # inline SVG icon set
  PhotoImg.tsx            # shared <PhotoImg> photo renderer (8.6). Three states: missing src → inert "no image" tile; loading → paper-3 skeleton; loaded → fade-in. Plain <img>, not next/image.
  settings.tsx            # SettingsProvider / useSettings (singleton AppSettings — branding, reviewer copy, accent, supportEmail, faviconStoragePath); BonusPeriodsProvider / useBonusPeriods (multiplier-bonus list). Both DB-backed.
  screens/
    HomeScreen.tsx        # uses live pendingCount from App.tsx
    ReviewScreen.tsx      # DB-backed approve/flag flow
    LeaderboardProfileGuide.tsx  # ProfileScreen reads live reviewer_stats; GuideScreen reads the live examples library and renders real images from Supabase Storage.
    Admin.tsx              # admin sub-screens. Overview reads live reviewer_stats; admins can edit any reviewer's role + team via the per-row dots button (lib/profile.ts → updateReviewerProfile; self-demotion guarded). Points / TagLibrary / BonusEvents / Examples / Settings are all DB-backed. SmugMugImport is re-exported from AdminSmugMug.tsx.
    AdminSmugMug.tsx       # operational dashboard (8.5). SettingsCard + EditConfigModal (with ModeSwitchConfirm), ActionsRow (Sync now + Prioritize), PrioritizeModal (DB-backed division→location→camp_week tree picker with pending-count badges), QueueListCard, SyncLogCard.
    FlagReview.tsx         # DB-backed senior queue
lib/
  current-user.tsx        # UserProvider, useCurrentUser, useUpdateTheme, Role + Theme types, ROLE_LABEL
  reviews.ts              # fetchPendingPhotos (orders by priority desc, captured_at <queueOrder>; selects image_url / thumbnail_url / smugmug_url), fetchPendingCount, fetchFlaggedPhotos, fetchFlaggedCount, fetchRecentPhotoThumbs, submitReview
  smugmug-config.ts       # client lib for smugmug_config singleton. fetchSmugmugConfig + updateSmugmugConfig (admin-only). Does NOT expose last_sync_* as patchable — those are owned by the service-role sync handlers.
  sync-log.ts             # fetchRecentSyncLog joins sync_log to profiles (left join — cron rows leave triggered_by NULL); reads gated by sync_log_select_admin.
  queue-list.ts           # Admin queue list. fetchQueueList paginates pending photos with all/priority/recent filters; fetchPendingWithoutReviewCount used by the Edit-config modal.
  profile.ts              # fetchMyStats, fetchReviewerRoster, updateReviewerProfile — backed by reviewer_stats view; admin role/team writes go to profiles base table under profiles_update_admin.
  tags.ts                 # fetchTags, partitionActiveTags, buildTagLabelLookup, createTag, setTagActive, deleteTag, slugifyTagId.
  app-settings.ts         # fetchAppSettings, updateAppSettings, uploadFavicon, removeFavicon, brandingAssetUrl resolver.
  points-config.ts        # fetchPointsConfig, updatePointsConfig, basePointsFor, DEFAULT_POINTS_CONFIG.
  bonus-periods.ts        # fetch / create / update / delete / setBonusPeriodEnabled. Backs BonusPeriodsProvider.
  examples.ts             # fetch / create / updateMetadata / replaceImage / delete / reorder. Owns Supabase Storage round-trips for the example-images bucket.
  quarantine-trigger.ts   # client helper. POST /api/smugmug/quarantine with { photoId }; called as `void triggerQuarantineMove(id)` from ReviewScreen (after flag-with-quarantine) and FlagReview (after senior accept/delete on a previously-quarantined photo). Fire-and-forget.
  smugmug/                # server-only SmugMug v2 API client (8.1)
    index.ts              # public surface + getAuthUser convenience
    oauth.ts              # OAuth 1.0a HMAC-SHA1 signer, RFC 3986 percent-encoding, env-var credential loader (sanitizes whitespace + stripped quotes)
    fetch.ts              # signed fetch wrapper, retry-on-429 (Retry-After), exp-backoff on 5xx, async-iterator paginate helper, manual 3xx redirect handling (re-signs each hop to avoid nonce reuse), SmugMugApiError
    types.ts              # Node, Album, Image, AuthUser, PageInfo response shapes
    nodes.ts              # getNode, listNodeChildren, getAlbumKeyForNode (extracts album key from Uris.Album.Uri)
    albums.ts             # getAlbum, listAlbumImages
    images.ts             # getImage
    users.ts              # getUserRootNode (entry point — root's children are the divisions)
    quarantine.ts         # 8.7 SmugMug helper: setImageHidden(imageKey, hidden) → PATCH /api/v2/image/<imageKey> with JSON body { Hidden: true|false }.
    sync/                 # iD Tech-specific tree interpretation (8.3 — translates SmugMug's generic Node tree into our Division/Location/Year/Week schema)
      types.ts            # WalkedDivision / WalkedLocation / WalkedYear / WalkedWeek shapes
      dates.ts            # parseCampWeekName — handles canonical "July 28 - August 1, 2025", en-dash, repeated-month, omitted-right-month, cross-year, hyphenated, and year-less variants
      walker.ts           # walkDivisions + walkDivisionDeep; auto-detects year-folder layer; flattens "Past Seasons"; skips retired-location aggregators inside divisions; parallelism capped at 5 × 5
      concurrency.ts      # mapWithConcurrency util used by the walker
      reconcile.ts        # service-role DB upsert logic for 8.3b apply (top-level + per-division deep)
      photos.ts           # 8.4 photo-sync core — runPhotoSync. Inserts in-flight sync_log row, reads smugmug_config for cutoff, walks each in-scope week's album with bounded concurrency, reconciles per spec.
      quarantine.ts       # 8.7 quarantine reconcile core — runQuarantineReconcile. Reads (is_quarantined, current_status), picks an action [is_quarantined=true → Hidden=true; is_quarantined=false + status=deleted → noop; is_quarantined=false + status<>deleted → Hidden=false], calls setImageHidden, writes quarantine_move sync_log row. Never throws — drift lands in sync_log.
  supabase/
    client.ts             # browser client (createBrowserClient)
    server.ts             # server client (createServerClient with cookies)
    service.ts            # service-role client (bypasses RLS — only for Route Handlers that have already enforced their own auth check)
    middleware.ts         # session refresh + auth-gating logic (whitelists /api/smugmug/sync-scheduled for cron)
middleware.ts             # root middleware, delegates to lib/supabase/middleware.ts
vercel.json               # Vercel cron config: daily 0 8 * * * UTC GET to /api/smugmug/sync-scheduled. Vercel auto-injects CRON_SECRET as a Bearer header.
styles/legacy.css         # ~650 lines, source of truth for visual styling
supabase/
  migrations/             # 25 SQL migrations applied to the work-account project (see SCHEMA_SPEC.md for the table)
  tests/                  # 5 hand-run SQL tests (smoke + 4 e2e). See README.md for run commands and SCHEMA_SPEC.md for what each covers.
  .temp/                  # gitignored — Supabase CLI cache
spec/
  PROJECT_CONTEXT.md      # this file
  SCHEMA_SPEC.md          # database design + post-implementation notes
```

Roles: `reviewer` (default) / `senior` / `admin`. The DB enum, the code's `Role` type, and the friendly UI labels all match — see [`README.md`](../README.md#roles) for the full breakdown.

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
- `SUPABASE_SERVICE_ROLE_KEY` — service-role secret; bypasses RLS. Used by the SmugMug sync handlers via `lib/supabase/service.ts`. NEVER expose to the browser.
- `SMUGMUG_API_KEY` / `SMUGMUG_API_SECRET` — OAuth 1.0a consumer credentials for the SmugMug v2 API
- `SMUGMUG_ACCESS_TOKEN` / `SMUGMUG_ACCESS_TOKEN_SECRET` — OAuth 1.0a access token + secret authorizing the consumer against the iD Tech SmugMug account
- `CRON_SECRET` — random opaque token (generate with `openssl rand -hex 32`). The scheduled-sync endpoint accepts a request only when `Authorization: Bearer ${CRON_SECRET}` matches. Vercel auto-injects this header on cron-invoked requests when the env var is set on the project.

Supabase publishable pair set in Vercel (all environments) and `.env.local` for local dev. The service-role key + SmugMug credentials + CRON_SECRET are local-only for now; they get pushed to Vercel once each substep is verified working.

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
| 8 | SmugMug API integration — admin-curated import pool with folder priority (not full auto-ingest) | ✅ Done |
| 9 | Next.js security upgrade (resolves audit warnings) | ✅ Done |
| 10 | Polish + team rollout | Pending |
| 11 | **Notifications backbone** — reminders, nudges, role-change pings, senior-routing fan-out on flag insert, `profile_status` idle/inactive transitions | Pending |

### Post-V1 / Phase 2

| # | Step | Status |
|---|---|---|
| 1 | (TBD — slot reserved for the next post-V1 priority) | Placeholder |
| 2 | **Notifications interface rebuild** — in-app bell / dropdown / notifications panel. The step-11 backbone covers delivery + data; this step is just the surface UI. *TODO: schema + UI design when picked up.* | Placeholder |

---

### Step 11 — Notifications backbone

The notification *system* lands in V1. Its purpose is intentionally narrow — it is **not** an assignment alert system. It exists for:

- **Reminders** — e.g. "you have N pending photos waiting", end-of-day nudges.
- **Nudges** — bonus period starting/ending, streak about to break (once streaks land), points-config changes worth flagging.
- **Role changes** — promoted to Senior, demoted back to Reviewer, etc.
- **Senior-routing fan-out** — driven by the existing `senior_routing_rules` table (migration 8). When a flag review row inserts and its tags intersect a rule's `tag_triggers`, the rule's `recipient_id` (a senior or admin) is notified on each of the rule's `channels`. This is a senior-side notification on flag, **not** a reviewer assignment — every reviewer and senior continues to see the same global pending queue regardless of routing rules.

Roughly the work in step 11:

- **Notifications infrastructure** — `notifications` table for in-app delivery; email transport via Resend or SendGrid through a Supabase Edge Function; `notification_preferences` per user (opt-out per channel and per kind).
- **Senior routing rules admin UI** — wire `senior_routing_rules` to a real admin screen. Tag triggers come from the live `tags` table; recipient is any `senior` or `admin` profile. Channels are filtered to whatever's actually wired (probably email on day one even though the schema permits slack/sms/inapp).
- **`profile_status` transitions** — wire the `active | idle | inactive` enum currently unused on `profiles`. Cron or trigger flips status based on `last_active_at`. Admin Overview's "Active reviewers" denominator filters by status instead of total profile count.

The in-app notifications **interface** (bell icon, dropdown, notifications panel) is **not** in step 11. It's deferred to post-V1 / Phase 2 step 2 — see the post-V1 table above. Step 11 lays the data + delivery layer; the interface gets rebuilt later.

Any signed-in `@idtech.com` Google account becomes a reviewer automatically via the `handle_new_user` trigger. There is no invite system and no assignment system.

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
- **Year folders inside SmugMug locations are not modeled.** SmugMug nests `Location → Year (2025/2026) → Camp Week`; our schema goes `Location → Camp Week` directly. Year is recoverable from `camp_weeks.starts_on`. The 8.3 walker handles year folders as a pass-through layer.
- **Review trigger functions are `SECURITY DEFINER`.** They run as the function owner so the inner UPDATEs on `photos` / `profiles` aren't filtered by the caller's RLS context. Anytime you write a trigger that mutates an RLS-protected table, mark it `security definer set search_path = public` or it'll fail silently in production. See the RLS gotcha below for the bug this fixes.
- **`Role` enum in code uses `reviewer` (not `staff`).** The DB enum is `('reviewer', 'senior', 'admin')`; the code matches it. The friendly label "Staff Reviewer" is preserved in `ROLE_LABEL.reviewer`.
- **No runtime feature toggles in V1.** Confetti is always on; leaderboard / streaks are deferred to a post-V1 release. The multiplier-bonus pennant *is* on, but it's data-driven (off when no bonus is enabled and active) — not a global feature flag.
- **Points Multiplier Bonus is fully DB-backed.** `bonus_periods` is its own multi-row table — `mode` discriminates recurring (days[] + HH:MM clock window) vs. one-time (timestamptz pair); `multiplier` is `numeric(4,2)` with a 1.10–10.00 check. The reviewer client passes an explicit `pointsAwarded = base × multiplier` into `submitReview` so `reviews.points_awarded` snapshots the bonused value the reviewer saw. The trigger's `points_config` lookup is the fallback for non-bonused write paths (senior accept / delete on FlagReview). Pennant re-evaluates on a 30s tick so windows start/end mid-session.
- **Theme is per-user; accent stays global; density removed.** `profiles.theme` (`('light','dark')` CHECK) backs the per-user picker on the Profile screen. `app_settings.accent` is the brand color, set by admins on Admin → Settings. Density was never wired (no `data-density` attribute, no compact CSS rules) — wiring it well isn't worth the work for an internal tool.
- **Admin Overview merged with Users.** One screen showing the reviewer roster with per-user stats (reviewed, points, last active, role, team), plus a small `Reviewed today` / `Active reviewers` stat row above the table. The standalone Users screen is gone — its search lives on the merged Overview header.
- **Team is a free-form label on `profiles.team`, not an access boundary.** It's a string admins set on the Overview row editor for grouping in the roster. It does **not** gate which photos a reviewer sees, which camp weeks they have access to, or which queue rows they're served. If teams ever need to drive anything (notification routing, reporting splits), normalize to a `teams` table at that point — but the current column is descriptive only.
- **No invitations.** Workspace OAuth already gates sign-in to `@idtech.com`; the `handle_new_user` trigger creates the profile on first login. There is no invite link, no `pending_invites` table, no pre-assigned role/team.
- **No assignment system, full stop.** The product does not assign specific photos, camp weeks, locations, or queues to specific reviewers, seniors, or teams. Reviewers and Senior Reviewers see the **same** pending queue ordered the same way; the only role-based difference is that Seniors (and Admins) additionally see Flag Review and can write `delete` decisions. There is no `assignments` table, no `assigned_to` column, no team-to-location mapping, no round-robin or per-user batch slicing, and no auto-reassignment on idle. The `senior_routing_rules` table (migration 8) is **notification routing on flag insert**, not assignment — it does not gate which photos seniors can see.
- **SmugMug ingest is admin-curated, not full auto-ingest.** Admins flip `divisions.synced = true` on the divisions whose subtrees should be deeply walked, set the season-start / earliest-fetch cutoff, and use "Prioritize in queue" to bump specific weeks. Full auto-ingest (everything SmugMug has, no curation) is intentionally not the design.
- **Quarantine is `Image.Hidden`, not an album move.** First cut tried `Album!collectimages` (then `AlbumImage` PATCH) to relocate quarantined photos into a global "Photo Reviewer — Quarantined" album; both produced subtle copy-rather-than-move semantics on SmugMug's many-to-many image/album graph. `Image.Hidden=true` does the same thing in one PATCH and doesn't touch the AlbumImage relationship at all — image stays in its camp_week album with all URLs intact, just stops appearing in public views and search.

---

## Known issues / gotchas to remember

- **The RLS-vs-trigger gotcha (resolved).** Trigger functions on `reviews` originally ran as the invoker. Their inner `UPDATE public.photos SET current_status = ...` was silently zero-rowed because `photos` has only a SELECT policy for authenticated users (writes are reserved for the import job via service role). Reviews inserted, but the photo status never moved. **Migration 14 marks all four review trigger functions `security definer set search_path = public`.** Anytime you write a trigger that mutates an RLS-protected table, mark it `security definer` or it'll fail silently in production.
- **Theme has a brief light-mode flash on cold loads.** `data-theme` stays `light` until the profile fetch resolves, so dark-mode users see ~few-hundred-ms of light flash on first paint. Acceptable for an internal app; SSR-injecting the theme would mean reading Supabase from the server layout and isn't worth it.
- **Browsers cache favicons aggressively.** After an admin replaces the favicon on Admin → Settings, reviewers may need to hard-refresh before they see the new icon. The replacement code already lands at a fresh storage path so the URL changes, but some browsers still cache by host.
- **Step 9 upgraded to Next 15.5.x LTS, not 16.** Pinned to `next@15.5.18` (the `backport` dist-tag) over `latest@16.x` to close every CVE in the original audit while skipping 16-only churn (Turbopack-default production builds, Node 20+ minimum, more lifecycle deprecations). The remaining 2 moderate `npm audit` items are an inherited postcss XSS in CSS-tooling reachable via `next/node_modules/postcss`; they would persist on Next 16 too and aren't worth chasing until Next bumps the bundled postcss. The Next-15 forced rewrite was async `cookies()` — handled in [lib/supabase/server.ts](../lib/supabase/server.ts) (now `async function createClient()` with `await cookies()`) and at every `await createClient()` server-side call site. `@dnd-kit/*` v6 was kept (works under React 19; v7 migration not needed) and the legacy `.eslintrc.json` was kept (still accepted by `eslint-config-next@15.5.x`; flat-config migration only becomes mandatory at v16). Spike notes in [STEP_9_SPIKE_NOTES.md](./STEP_9_SPIKE_NOTES.md). **Don't run `npm audit fix --force`** — it will downgrade Next.
- **Pre-existing build warning:** `no-page-custom-font` in `app/layout.tsx`. Cosmetic only. Google Fonts are loaded via `<link>` rather than `next/font` to preserve the existing CSS font stacks unchanged.
- **Vercel does not follow GitHub redirects.** If the repo is moved/transferred again in the future, the Vercel project must be manually reconnected to the new repo location. (Same for the local `origin` remote URL — that was updated to the new canonical work-org URL on 2026-05-05.)
- **Tag deletes can soft-fail (by design).** `review_tags.tag_id → tags.id` is `on delete restrict`, so once a tag has ever been used on a flag/approve, hard-deleting it raises `23503`. The Admin TagLibrary catches that and falls back to flipping `active = false`, which hides the tag from the review modals while keeping historical labels intact via `buildTagLabelLookup` (which includes inactive rows). If you ever need to bulk-purge truly unused tags, hitting the DB with `delete from public.tags where active = false and id not in (select tag_id from public.review_tags)` is safe.
- **SmugMug `fetch` redirects need manual handling.** Node's `fetch` (undici) auto-follows 3xx and re-sends the same `Authorization` header, which trips OAuth 1.0a's nonce-reuse check on SmugMug's image-versioning canonicalization redirects. `lib/smugmug/fetch.ts` uses `redirect: "manual"` and re-signs each hop; don't undo that.
