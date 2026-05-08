# iD Tech Photo Reviewer — Project Context

> **Purpose of this document:** Hand off context to a fresh thread (or any collaborator) so we can pick up work without re-explaining the whole project. Update this whenever the architecture, infrastructure, or roadmap changes.

---

## What this app is

A gamified internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Built as an internal web app, not customer-facing. Used by a known group of employees who sign in with their iD Tech Google Workspace accounts.

Reviewers move through a queue of photos and either **approve** them (share-worthy — rate, optionally tag, +10 pts) or **flag** them (anything that isn't a clear approve — tag what's wrong, optional note, +15 pts). Flagged photos go to a separate **Flag Review** queue handled by Senior Reviewers, who make the final call: accept the photo back into the library, delete it, or download it for an offline conversation with a director.

---

## Where we are

Step 7 (Supabase persistence) is complete. The reviewer + senior flows, tags, examples, points, multiplier-bonus schedule, app settings, branding favicon, and per-user theme are all DB-backed under RLS. 23 migrations applied to the work-account Supabase project.

**Active phase: step 8 — SmugMug API integration.** Substeps 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, and 8.7 are done:
- **8.1** — `lib/smugmug/` ships an OAuth 1.0a-signed fetch wrapper plus typed Node/Album/Image helpers; `/api/smugmug/ping` is the admin-gated smoke endpoint that confirms credentials and signing are healthy.
- **8.2** — Migration 21 lands `smugmug_config` (singleton: mode, season_start_date, earliest_fetch_date, queue_order, last_sync_at, last_sync_status), `photos.priority` (int default 0, partial composite index for the pending queue), and `sync_log` (audit trail with sync_kind / sync_status enums, started_at-desc index, admin-read-only RLS). Singleton seeded `summer / Jan 1 of current year / newest_first`. No code reads any of this yet — wiring happens in 8.3 onward.
- **8.3** — Migration 22 added `divisions.synced` (boolean, default false; the two seeded camp divisions flipped to true). `/api/smugmug/sync-folders` is a two-verb endpoint: GET is the read-only discovery layer (walks SmugMug, cross-references against `public.divisions`, drills into one division with `?division=<nodeId>`); POST is the apply layer (service-role writes, idempotent, top-level only with no query param OR deep with `?division=<nodeId>` — the deep variant refuses unless that division has `synced=true`). The walker uses bounded concurrency (5 locations + 5 year-folders in flight). Reconciliation matches by `smugmug_folder_id` first, falls back to normalized-name (en-dash → hyphen, whitespace collapse) for placeholder rows from migration 13. The existing-weeks query paginates in 1000-row batches to defeat PostgREST's default response cap. The week-name parser handles four format variants (canonical, en-dash, repeated month, hyphenated, year-less with parent-year fallback). The walker skips two kinds of aggregator folders: "Past Seasons" inside locations (recurses to find more year folders) and "Historical Locations" / "Previous Locations" inside divisions (skipped entirely — V1 doesn't sync retired-location subtrees). Verified end-to-end against the iD Tech account: 15 divisions reconciled (2 placeholders → real, 13 new), 83 locations under iD Tech Camps (1 placeholder → real), 3,789 camp weeks. Only 2 SmugMug folders un-parseable (admin-side scratch folders like "Set Up 2012", "Guest Cards" — correctly excluded). Three scope adjustments from the original 8.3 spec: (a) hardcoded division allowlist became the admin-controlled `synced` flag, since retired divisions sit alongside active ones in the SmugMug account; (b) folder sync isn't actually "cheap, unbounded" for an org with 12 years of camp history, so the apply step targets one division at a time rather than walking everything; (c) "Historical Locations" gets explicitly skipped — first deep apply naively created a junk location row + surfaced ~150 retired-location names as un-parseable "weeks", so the walker filters them out at the location-children layer.
- **8.4** — Two new Route Handlers under `/api/smugmug/`: `sync-now` (POST, admin-session-gated, `kind='manual'`) for the eventual "Sync now" admin button, and `sync-scheduled` (GET, CRON_SECRET-bearer-gated, `kind='scheduled'`) wired to a daily Vercel Cron at `0 8 * * *` UTC (≈ 4am EDT in summer, 5am EST in winter — see `vercel.json`). Both delegate to one core in `lib/smugmug/sync/photos.ts → runPhotoSync` so the auth boundary is the only difference between the two paths. The core inserts an in-flight `sync_log` row, reads `smugmug_config` to pick a cutoff date (`season_start_date` in summer, `earliest_fetch_date` in off-season), pulls every `camp_weeks` row whose `starts_on >= cutoff` under a `divisions.synced=true` parent (paginated 1000-at-a-time), then walks each week's SmugMug album with bounded concurrency (5 in flight). Reconciliation per spec: match by `smugmug_image_id` and update on drift; cross-week match handles re-parented photos by updating `camp_week_id`; missing-from-SmugMug rows with no `reviews` history get DELETE'd, rows with reviews stay forever. New `getAlbumKeyForNode(nodeId)` helper in `lib/smugmug/nodes.ts` fetches the node and extracts the album key from `Uris.Album.Uri`; `lib/supabase/middleware.ts` adds `/api/smugmug/sync-scheduled` to its public-paths whitelist so cron requests reach the handler instead of redirecting to /login. Verified end-to-end against the iD Tech account on first land: 4 in-scope weeks → +356 / ~0 / -7 (the 7 unreviewed placeholder seed photos cleaned up; the 3 reviewed placeholders preserved per the immutability rule), idempotent re-run was 0/0/0, manual drift on a real photo plus a manual delete corrected to ~1 / +1 on the next pass.
- **8.5** — `Admin → SmugMug import` is now the real operational dashboard, lifted into [components/screens/AdminSmugMug.tsx](../components/screens/AdminSmugMug.tsx) (Admin.tsx re-exports `SmugMugImport` from there to keep `App.tsx` untouched). Four cards: a settings card with edit modal (mode + dates + queue order; the mode-switch save path swaps to a 3-button keep/clear/cancel dialog when there are unreviewed pending photos), an actions row (Sync now → 8.4 manual endpoint; Prioritize in queue → folder picker tree), a paginated queue list with all/priority/recent (14d) filters, and a sync-log table showing the last 20 runs with expandable error details. Two new admin-gated Route Handlers back the screen: `/api/smugmug/prioritize` (POST, scope+id body, resolves the camp_week subtree, bulk `UPDATE photos SET priority = 1 WHERE camp_week_id IN (...) AND current_status='pending' AND priority < 1`, writes a `priority_add` sync_log row) and `/api/smugmug/clear-pending` (POST, deletes every pending photo with no `reviews` history in 1000-id chunks, writes a `mode_switch` sync_log row). Three new client libs (`lib/smugmug-config.ts`, `lib/sync-log.ts`, `lib/queue-list.ts`) wrap the singleton + log + queue reads. The picker is DB-backed only — divisions where `synced=true` → locations → camp_weeks already known to `public.camp_weeks` — and shows pending-count badges at every level so the admin sees what they're about to bump (no on-the-fly SmugMug calls during prioritize). V1 has no per-row unprioritize; the only reset path is the mode-switch "clear the queue" dialog, which deletes all unreviewed pending photos so the next sync rebuilds at `priority = 0`. Reviewer queue ordering also wired in this step: `lib/reviews.ts → fetchPendingPhotos` now sorts by `priority desc, captured_at <queueOrder>` and `ReviewScreen.tsx` reads `queue_order` from `smugmug_config` once at session start to pick the captured_at direction.
- **8.6** — Real SmugMug image rendering everywhere. The prototype-era gradient `PhotoPlaceholder` (`components/data.tsx`) is gone — file deleted — replaced by a single shared `<PhotoImg>` ([components/PhotoImg.tsx](../components/PhotoImg.tsx)) that renders the `image_url` / `thumbnail_url` columns the 8.4 sync engine populates, with a loading skeleton, an onError fallback to an inert "no image" tile, and `loading="lazy"` on grid views (`eager` on the reviewer hero + senior detail card). `lib/reviews.ts` now selects `image_url, thumbnail_url, smugmug_url` on both `fetchPendingPhotos` and `fetchFlaggedPhotos`, and exposes a small `fetchRecentPhotoThumbs` helper for the HomeScreen hero strip — that strip used to render 10 hashed-id gradients; it now shows the next 10 pending thumbnails (in queue order, so it doubles as a "what's coming up" preview) and collapses entirely when the queue is empty. `FlagReview.tsx`'s "Download" button stops procedurally drawing a labeled gradient PNG via `<canvas>` and instead `fetch()`-es the real SmugMug `imageUrl` (falling back to `thumbnailUrl`), blob-URLs the response, and triggers a download with a friendly filename keyed off the image extension. The ReviewScreen hero, the FlagReview queue thumbnails, the FlagReview detail card hero, and the HomeScreen strip all now render real SmugMug imagery.
- **8.7** — Quarantine folder move. The `reviews_update_quarantine` trigger (migration 6) has always maintained `photos.is_quarantined`; what 8.7 adds is the actual SmugMug-side side effect — physically moving the image into a single global Unlisted "Photo Reviewer — Quarantined" album at the SmugMug user root, and back to its camp_week album on senior accept. Migration 23 lands `smugmug_config.quarantine_album_key` (lazy-populated cache of the album's AlbumKey) and adds `'quarantine_move'` to the `sync_kind` enum so each move attempt audits as its own row alongside scheduled / manual / mode_switch / priority_add. Three new server-only files: [lib/smugmug/quarantine.ts](../lib/smugmug/quarantine.ts) wraps SmugMug's `Image!Album` lookup, the `Album!collectimages` move verb (with `MoveImages=true`), and a find-or-create-Unlisted-album-at-root helper; [lib/smugmug/sync/quarantine.ts](../lib/smugmug/sync/quarantine.ts) hosts `runQuarantineReconcile`, which picks an action from `(is_quarantined, current_status)` — quarantine moves to the global album, release moves back to the camp_week's `smugmug_folder_id`, deleted is a clean noop per spec — does an idempotency check via `getImageAlbumKey` to skip the move when already in target, refreshes the four URL columns on `photos` after every real move (SmugMug's WebUri/ArchivedUri/ThumbnailUrl can be album-contextual and go stale on move), and writes a `quarantine_move` sync_log row in either success or failed terminal state. The new admin-not-required Route Handler at [app/api/smugmug/quarantine/route.ts](../app/api/smugmug/quarantine/route.ts) takes `{ photoId }`, runs the reconcile under the service-role client, and always returns 200 — drift surfaces as a `quarantine_move` / `failed` row on the existing Admin → SmugMug → Sync log card with no UI changes (the AdminSmugMug `KindPill` got a `Quarantine` label, and `lib/sync-log.ts → SyncKind` got the new union member). Client wiring is fire-and-forget through [lib/quarantine-trigger.ts](../lib/quarantine-trigger.ts), called from `ReviewScreen.commitDecision` after a flag-with-quarantine submission and from `FlagReview.resolve` after senior accept/delete on a previously-quarantined photo. The reviewer never blocks on the SmugMug round-trip; the route writes the audit trail. Lazy-album-create is race-safe via `update ... where id=1 and quarantine_album_key is null` followed by a re-read; worst case is a one-time orphan album on the very first concurrent quarantine, which is admin-deletable.

### What works end-to-end
- Production deployment on Vercel (auto-deploys from `main`); Google OAuth gated to `@idtech.com` via Workspace Internal app.
- `useCurrentUser` reads role + theme + id from `profiles`. Theme is per-user; `data-theme` on `<html>` flips with `useUpdateTheme`. The dev role-switcher is gone.
- Reviewer queue (`ReviewScreen`) reads pending photos and writes `reviews` + `review_tags`. The Approve/Flag buttons multiply the per-decision base from `points_config` by the active bonus multiplier and pass the result to `submitReview` as `pointsAwarded`, so `reviews.points_awarded` snapshots the bonused value the reviewer actually saw. The flag modal exposes a Quarantine checkbox that flows through to `reviews.quarantine`.
- Senior queue (`FlagReview`) joins photos + hierarchy + flagging reviewer + tags; accept/delete decisions write reviews. Quarantine surfaces as both a row pill and a rose banner on the detail panel.
- Sidebar Review and Flag-review badges, HomeScreen subtitle `{count}` template, and the bonus pennant (HomeScreen banner + ReviewScreen header) all read live.
- ProfileScreen + Admin Overview both read from `public.reviewer_stats` (security-invoker view joining `profiles` with aggregated `reviews`; one row per profile, zero-filled aggregates). Admin Overview can edit any reviewer's role + team via a modal that writes through `lib/profile.ts → updateReviewerProfile` (RLS via `profiles_update_admin`); self-lockout is prevented client-side. ProfileScreen has its own Appearance card with the per-user theme picker.
- All four review triggers fire correctly under RLS (see "RLS gotcha" below).

### What does NOT work yet
- Admin Overview "Active reviewers" denominator equals total profile count (no `profiles.status` filter). → **step 11** — wired alongside the `profile_status` idle/inactive transitions in the notifications-backbone step.
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
  api/smugmug/
    ping/route.ts         # admin-only smoke endpoint; hits SmugMug !authuser and returns the nickname so we can verify creds + signing without touching the DB
    sync-folders/route.ts # admin-only folder-tree sync endpoint (step 8.3). GET = discovery (annotates SmugMug tree against public.divisions; ?division=<nodeId> drills deep). POST = apply (service-role writes through lib/smugmug/sync/reconcile.ts; ?division=<nodeId> for deep with a synced=true gate). maxDuration=300 for Vercel Pro.
    sync-now/route.ts     # step 8.4 manual photo-sync endpoint (POST, admin-session-gated). Records the admin's id on sync_log.triggered_by and delegates to lib/smugmug/sync/photos.ts → runPhotoSync. The "Sync now" button in 8.5's admin UI calls this.
    sync-scheduled/route.ts # step 8.4 scheduled photo-sync endpoint (GET, CRON_SECRET-bearer-gated). Wired to vercel.json's daily 0 8 * * * UTC cron. Delegates to the same runPhotoSync core; sync_log.triggered_by stays NULL for cron runs.
    prioritize/route.ts   # step 8.5 "Prioritize in queue" endpoint (POST, admin-session-gated). Body { scope: "division"|"location"|"camp_week", id }; resolves the camp_week subtree, bulk-flips photos.priority=1 on pending rows under it (with priority<1 predicate to keep update counts honest), and writes a priority_add sync_log row. No SmugMug API calls.
    clear-pending/route.ts # step 8.5 mode-switch reset endpoint (POST, admin-session-gated). Deletes every pending photo with no `reviews` history (chunked at 1000 ids per DELETE to dodge query-string limits) and writes a mode_switch sync_log row. Triggered from the Edit-config modal's "Switch and clear the queue" button.
    quarantine/route.ts   # step 8.7 quarantine folder move endpoint (POST, any-authenticated). Body { photoId }. Delegates to lib/smugmug/sync/quarantine.ts → runQuarantineReconcile under the service-role client; reads photos.is_quarantined + current_status to pick action (quarantine | release | noop), moves the image via Album!collectimages with MoveImages=true into / out of the lazy-created global "Photo Reviewer — Quarantined" album at the SmugMug user root, refreshes URL columns on the photo row, and writes a quarantine_move sync_log row. Always returns 200 — drift lands in sync_log for the admin to see.
components/
  App.tsx                 # root client component, role-gated screen routing; owns the live pendingCount fetch. Applies data-theme from useCurrentUser, --sun accent from useSettings.
  Shell.tsx               # Sidebar (live Review + Flag-review badges, role-aware nav), PageHeader, fireConfetti, useToast
  Icon.tsx                # inline SVG icon set
  PhotoImg.tsx            # Step 8.6 — shared `<PhotoImg>` photo renderer used by ReviewScreen hero, FlagReview queue + detail, HomeScreen hero strip, and AdminSmugMug queue list. Three states: missing src → inert "no image" tile; loading → paper-3 skeleton; loaded → fade-in. onError swaps to the same fallback as missing src. Plain `<img>` (not `next/image`) since SmugMug serves variants directly and we don't want Next's optimizer proxying them.
  settings.tsx            # Two providers + helpers. SettingsProvider / useSettings backs the singleton AppSettings (branding, reviewer copy, accent, supportEmail, faviconStoragePath) — DB-backed via lib/app-settings.ts. BonusPeriodsProvider / useBonusPeriods backs the multiplier-bonus list — DB-backed via lib/bonus-periods.ts. Also exports activeBonusPeriod / formatBonusWindow / formatBonusMultiplier / fillTemplate.
  screens/
    HomeScreen.tsx        # uses live pendingCount from App.tsx
    ReviewScreen.tsx      # DB-backed approve/flag flow
    LeaderboardProfileGuide.tsx  # ProfileScreen reads live `reviewer_stats` (career stats, decision breakdown, activity card) and has the per-user theme picker. GuideScreen reads the live `examples` library and renders real images from Supabase Storage.
    Admin.tsx              # admin sub-screens. Overview reads live `reviewer_stats` and admins can edit any reviewer's role + team via the per-row dots button (writes through lib/profile.ts → updateReviewerProfile; self-demotion guarded). Points / TagLibrary / BonusEvents / Examples / Settings are all DB-backed. SmugMugImport is re-exported from AdminSmugMug.tsx (split out in 8.5 — Admin.tsx was already 2.9k lines).
    AdminSmugMug.tsx       # step 8.5 — Admin → SmugMug operational dashboard. Composes SettingsCard + EditConfigModal (with ModeSwitchConfirm dialog), ActionsRow (Sync now + Prioritize in queue), PrioritizeModal (DB-backed division→location→camp_week tree picker with pending-count badges at every level), QueueListCard (paginated, all/priority/recent filters, real `<img>` thumbnails), and SyncLogCard (last 20 runs, expandable error details). Talks to /api/smugmug/sync-now, /api/smugmug/prioritize, /api/smugmug/clear-pending; reads via lib/smugmug-config.ts, lib/queue-list.ts, lib/sync-log.ts.
    FlagReview.tsx         # DB-backed senior queue
lib/
  current-user.tsx        # UserProvider, useCurrentUser, useUpdateTheme, Role + Theme types, ROLE_LABEL. Reads role + theme from profiles. The setter writes through the existing profiles_update_self RLS policy.
  reviews.ts              # fetchPendingPhotos (orders by priority desc, captured_at <queueOrder> as of step 8.5; queueOrder defaults to newest_first and is sourced from smugmug_config by ReviewScreen; selects image_url / thumbnail_url / smugmug_url as of 8.6 so the reviewer hero can render the real image), fetchPendingCount, fetchFlaggedPhotos (selects the same image columns for FlagReview), fetchFlaggedCount, fetchRecentPhotoThumbs (8.6 — small batch of next-up thumbnails for the HomeScreen decorative strip), submitReview
  smugmug-config.ts       # step 8.5 client lib for the smugmug_config singleton (id=1). fetchSmugmugConfig + updateSmugmugConfig (admin-only via smugmug_config_write_admin RLS). Mirrors lib/points-config.ts; does NOT expose last_sync_at/last_sync_status as patchable — those columns are owned by the service-role sync handlers.
  sync-log.ts             # step 8.5 client lib. fetchRecentSyncLog joins sync_log to profiles (left join — cron rows leave triggered_by NULL); reads gated by sync_log_select_admin.
  queue-list.ts           # step 8.5 client lib for the Admin queue list. fetchQueueList paginates pending photos with all/priority/recent (14d) filters and the same priority desc, captured_at <queueOrder> ordering as the reviewer queue. fetchPendingWithoutReviewCount used by the Edit-config modal to decide whether to show the mode-switch keep/clear dialog.
  profile.ts              # fetchMyStats, fetchReviewerRoster, updateReviewerProfile — backed by `reviewer_stats` view. Admin role/team writes go to the `profiles` base table under `profiles_update_admin`.
  tags.ts                 # fetchTags, partitionActiveTags, buildTagLabelLookup, createTag, setTagActive, deleteTag, slugifyTagId. Backs ReviewScreen, FlagReview, and AdminTagLibrary.
  app-settings.ts         # fetchAppSettings, updateAppSettings — single-row config (brand_*, reviewer copy, accent, support_email, favicon_storage_path). Plus uploadFavicon / removeFavicon (Supabase Storage round-trips for the branding-assets bucket) and a brandingAssetUrl resolver. Backs SettingsProvider.
  points-config.ts        # fetchPointsConfig, updatePointsConfig, basePointsFor, DEFAULT_POINTS_CONFIG. Backs ReviewScreen + AdminPoints.
  bonus-periods.ts        # fetchBonusPeriods, createBonusPeriod, updateBonusPeriod, deleteBonusPeriod, setBonusPeriodEnabled. Backs BonusPeriodsProvider, which Shell.tsx + AdminPoints both consume.
  examples.ts             # fetchExamples, createExample, updateExampleMetadata, replaceExampleImage, deleteExample, reorderExamples. Owns the Supabase Storage round-trips for the example-images bucket. Backs AdminExamples + GuideScreen.
  quarantine-trigger.ts   # step 8.7 client helper. Single-purpose: POST /api/smugmug/quarantine with { photoId } and console.warn on drift. Used by ReviewScreen (after flag-with-quarantine) and FlagReview (after senior accept/delete on a previously-quarantined photo). Always called as `void triggerQuarantineMove(id)` — fire-and-forget; the user-facing flow doesn't block on the SmugMug round-trip.
  smugmug/                # server-only SmugMug v2 API client (step 8.1)
    index.ts              # public surface + getAuthUser convenience
    oauth.ts              # OAuth 1.0a HMAC-SHA1 signer, RFC 3986 percent-encoding, env-var credential loader
    fetch.ts              # signed fetch wrapper, retry-on-429 (Retry-After), exp-backoff on 5xx, async-iterator paginate helper, SmugMugApiError
    types.ts              # Node, Album, Image, AuthUser, PageInfo response shapes
    nodes.ts              # getNode, listNodeChildren (paginated)
    albums.ts             # getAlbum, listAlbumImages (paginated)
    images.ts             # getImage
    users.ts              # getUserRootNode (entry point for tree traversal — root's children are the divisions)
    quarantine.ts         # step 8.7 SmugMug helpers: getImageAlbumKey (idempotency check before move), moveImageToAlbum (Album!collectimages with MoveImages=true), findOrCreateQuarantineAlbum (find-or-create the global Unlisted "Photo Reviewer — Quarantined" album at root; handles the "create succeeded but DB write failed" partial-failure case via list-then-create lookup)
    sync/                 # iD Tech-specific tree interpretation (step 8.3 — translates SmugMug's generic Node tree into our Division/Location/Year/Week schema)
      types.ts            # WalkedDivision / WalkedLocation / WalkedYear / WalkedWeek shapes returned by the walker
      dates.ts            # parseCampWeekName — handles canonical "July 28 - August 1, 2025", en-dash variant, repeated-month variant, omitted-right-month variant, cross-year "December 30 - January 3, 2026", hyphenated "June-02-June-06-2014", and year-less "June 24 - 28" when given a yearHint from the parent year folder
      walker.ts           # walkDivisions (top-level only) + walkDivisionDeep (locations → year folders → weeks); auto-detects year-folder layer; flattens "Past Seasons" aggregators inside locations; SKIPS "Historical Locations" / "Previous Locations" / "Past Locations" / "Retired Locations" inside divisions (retired-location subtrees aren't synced in V1); parallelism capped at 5 locations × 5 year-folders in flight
      concurrency.ts      # mapWithConcurrency util used by the walker so a single deep walk doesn't fan out hundreds of unbounded API calls
      reconcile.ts        # service-role DB upsert logic for 8.3b apply: top-level division reconcile + per-division deep reconcile; matches by smugmug_folder_id then by normalized name for placeholder swap-in; paginates the existing-weeks select in 1000-row batches to defeat PostgREST's default row cap
      photos.ts           # step 8.4 photo-sync core — runPhotoSync inserts an in-flight sync_log row, reads smugmug_config to pick a cutoff date (season_start_date in summer, earliest_fetch_date in off-season), pulls every camp_weeks row whose starts_on >= cutoff under a divisions.synced=true parent, and walks each week's SmugMug album with bounded concurrency (5 in flight). Reconciles per spec: smugmug_image_id match → update on drift; cross-week match → re-parent (camp_week_id update); missing-from-SmugMug + no reviews → DELETE; missing-from-SmugMug + has reviews → leave alone. Updates sync_log + smugmug_config.last_sync_* on completion.
      quarantine.ts       # step 8.7 quarantine reconcile core — runQuarantineReconcile reads the photo + camp_week, picks an action from (is_quarantined, current_status) per the rule [is_quarantined=true → quarantine; is_quarantined=false + status=deleted → noop; is_quarantined=false + status<>deleted → release], lazy-creates the global Quarantined album on first use (cached on smugmug_config.quarantine_album_key with race-safe persist), short-circuits when the image is already in the target album, refreshes photos.image_url/thumbnail_url/smugmug_url/smugmug_folder_id after every real move, and writes a quarantine_move sync_log row in success or failed terminal state. Never throws to the caller — the route handler always returns 200 and drift lands in sync_log.
  supabase/
    client.ts             # browser client (createBrowserClient)
    server.ts             # server client (createServerClient with cookies)
    service.ts            # service-role client (bypasses RLS — only for Route Handlers that have already enforced their own auth check; used by the SmugMug sync apply step 8.3b onward)
    middleware.ts         # session refresh + auth-gating logic
middleware.ts             # root middleware, delegates to lib/supabase/middleware.ts
vercel.json               # Vercel cron config: daily 0 8 * * * UTC GET to /api/smugmug/sync-scheduled (step 8.4). Vercel auto-injects the CRON_SECRET as a Bearer header for cron-invoked requests when the env var is set on the project.
styles/legacy.css         # ~650 lines, source of truth for visual styling
supabase/
  migrations/             # 23 SQL migrations applied to the work-account project (see SCHEMA_SPEC.md for the table)
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
- `SUPABASE_SERVICE_ROLE_KEY` — service-role secret; bypasses RLS. Used by the SmugMug sync handlers (8.3b onward) via `lib/supabase/service.ts`. NEVER expose to the browser. Added in step 8.3a.
- `SMUGMUG_API_KEY` / `SMUGMUG_API_SECRET` — OAuth 1.0a consumer credentials for the SmugMug v2 API (added in step 8.1)
- `SMUGMUG_ACCESS_TOKEN` / `SMUGMUG_ACCESS_TOKEN_SECRET` — OAuth 1.0a access token + secret authorizing the consumer against the iD Tech SmugMug account (added in step 8.1)
- `CRON_SECRET` — random opaque token (generate with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). The 8.4 scheduled-sync endpoint accepts a request only when `Authorization: Bearer ${CRON_SECRET}` matches. Vercel auto-injects this header on cron-invoked requests when the env var is set on the project; for local testing, pass the same value via `curl -H "Authorization: Bearer $CRON_SECRET"`. Added in step 8.4.

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
| 8 | **SmugMug API integration** — admin-curated import pool with folder priority (not full auto-ingest); 8.1–8.7 done, 8.8 pending | 🟡 Active |
| 9 | Next.js security upgrade (resolves audit warnings) | Pending |
| 10 | Polish + team rollout | Pending |
| 11 | **Notifications backbone** — reminders, nudges, role-change pings, senior-routing fan-out on flag insert, `profile_status` idle/inactive transitions | Pending |

### Post-V1 / Phase 2

| # | Step | Status |
|---|---|---|
| 1 | (TBD — slot reserved for the next post-V1 priority) | Placeholder |
| 2 | **Notifications interface rebuild** — in-app bell / dropdown / notifications panel. The step-11 backbone covers delivery + data; this step is just the surface UI. *TODO: schema + UI design when picked up.* | Placeholder |

---

### Step 8 — SmugMug API integration

Step 8 — SmugMug import + real photo rendering
The goal is to retire the placeholder-* data and the PhotoPlaceholder gradient renderer in favor of a real, scheduled SmugMug ingestion pipeline driven by a small set of admin-configurable rules. The Admin → SmugMug screen becomes the operational dashboard for everything photo-flow related. No reviewer-facing curation; auto-import handles the steady state.
The substeps below are in dependency order. Each one is independently testable and can land in its own commit/migration.
8.1 — SmugMug API client (server-only)
A new lib/smugmug/ module wrapping the four credential env vars already stubbed in .env.local.example. OAuth 1.0a request signing, typed wrappers around the Node, Folder, and Image endpoints, and a fetch helper that respects SmugMug's rate limits with retry-on-429. Server-only — the secrets cannot ship to the browser, so the module is imported exclusively from Route Handlers under app/api/smugmug/*. No DB writes here; this layer just talks to SmugMug.
Worth a quick auth-method check with whoever owns the SmugMug account before writing code, since the env-var slots match OAuth 1.0a but SmugMug also supports newer schemes. If the issued credentials are the newer variety, the module shape doesn't change but the signing path does.
8.2 — Schema additions
One migration that lands all of the new columns and tables before any code reads them:
A new singleton smugmug_config table (id = 1, same pattern as points_config and app_settings) with columns: mode (enum: summer | off_season), season_start_date (date, used in summer mode), earliest_fetch_date (date, used in off-season mode), queue_order (enum: newest_first | oldest_first), last_sync_at (timestamptz), last_sync_status (text). Seeded with sensible defaults: summer mode, current year's start date, newest_first.
A priority integer column on photos, default 0, indexed. Queue ordering becomes ORDER BY priority DESC, captured_at <queue_order>. Manual-add sets priority to 1.
The photo_status enum stays as-is (pending, approved, flagged, deleted). No new value. Photos that leave the queue without a review — mode-switch bulk-clear, or disappeared from SmugMug — get DELETE'd outright. Photos with review history are immutable as they always were.
A new sync_log table: id, started_at, finished_at, kind (scheduled | manual | mode_switch | priority_add), status (success | partial | failed), photos_added, photos_updated, photos_removed, error_summary (nullable text), triggered_by (nullable uuid → profiles, null for scheduled runs). Indexed on started_at desc for the sync-log table view.
RLS: smugmug_config follows the established pattern (everyone reads, admins write). sync_log is admin-read-only; writes happen via service role from the cron handler, which bypasses RLS by design.
8.3 — Folder-tree sync
A Route Handler at app/api/smugmug/sync-folders/route.ts that walks the SmugMug tree under iD Tech Camps and iD Teen Academies and reconciles divisions / locations / camp_weeks. The seed migration was written so update ... where smugmug_folder_id like 'placeholder-%' swaps in real IDs without breaking FKs — that's the path. The four real divisions stay (with the two non-camp ones existing but ignored by photo sync); the placeholder Adelphi location and its single placeholder week get either reconciled to real values or deleted depending on what SmugMug actually returns.
Idempotent, safe to re-run, runs under the service role. Folder-structure sync is unbounded (cheap) — the date scoping happens at the photo-enumeration layer in 8.4.
8.4 — Photo enumeration + scheduled sync
The actual import job, also a Route Handler. Walks each in-scope camp week and enumerates its images into public.photos with current_status = 'pending', populating image_url, thumbnail_url, captured_at, caption, width, height, and smugmug_image_id. In-scope is determined by mode:
In Summer Mode, scope is camp_weeks where starts_on >= the date the admin has entered for the start of camp that year
In Off-Season Mode, scope is camp_weeks where starts_on >= smugmug_config.earliest_fetch_date. No upper bound; the admin is doing archival cleanup.
Reconciliation rules:

Photos already in the table are matched by smugmug_image_id and updated in place, not re-inserted.
Photos missing from SmugMug that have no review yet are DELETE'd. The sync_log.photos_removed counter captures the aggregate.
Photos missing from SmugMug that have at least one review row are left untouched in whatever terminal state their last review put them in. Review history is forever.
Re-parented photos (same smugmug_image_id, different parent folder on SmugMug) get their camp_week_id updated.

The job writes one row to sync_log per run, with the kind set appropriately.
Scheduled invocation: Vercel Cron at 4am Eastern daily. Manual invocation: a POST /api/smugmug/sync-now endpoint called from the admin UI's "Sync now" button, with an admin-role check at the handler level (the service-role write happens after the auth check, not before).
8.5 — Admin SmugMug screen rewrite
Replace the static placeholder SmugMugImport component with the real screen. Four sections:
A settings card rendering current mode, season-start (summer) or earliest-fetch (off-season), queue order, and last sync timestamp/status. Edit button opens a modal with all four settings. Mode-switch within that modal triggers a confirmation dialog with three explicit choices when current pending count > 0: "Switch and keep pending photos," "Switch and clear the queue" (DELETE pending photos that have no reviews), or "Cancel." The dialog states the consequence in plain language ("847 photos are currently pending. What should happen to them?").
An actions row with two buttons: "Sync now" (calls 8.4's manual endpoint), and "Add folder to queue" (opens a SmugMug folder picker — the same tree-walker built in 8.3, but rendered as a modal browser, no drag-to-reorder, just pick a folder and confirm "Add 234 photos from [folder] to top of queue?"). Manual adds write priority = 1 and log a priority_add entry to sync_log.
A queue list, paginated, showing thumbnail, camp week, captured-at, priority badge if non-zero, status. Read-only (no per-row admin actions). Filter by priority-only or recent-only. Sort defaults match the reviewer queue's effective order.
A sync log table showing the last 20 rows from sync_log — "Yesterday 4:02am · Scheduled · Success · +147 photos" — with each row expandable to show error_summary if non-empty.
8.6 — Image rendering rollout
Drop PhotoPlaceholder from components/data.tsx and every consumer: the HomeScreen hero strip, ReviewScreen hero, FlagReview cards, SessionComplete summary. AdminExamples already has its own image pipeline and is unaffected. Each photo row has image_url and thumbnail_url populated by 8.4, so rendering becomes a real <img> with proper alt, loading="lazy" on grid views, and a graceful fallback for the rare case where SmugMug is unreachable mid-session.
The Flag Review "Download" button switches from rendering the placeholder gradient to a fetch of the real SmugMug image URL — the existing comment in the FlagReview screen anticipates this swap.
8.7 — Quarantine folder move
The reviews_update_quarantine trigger (migration 6) already maintains photos.is_quarantined. The actual SmugMug folder move — out of the public folder when quarantined, back when a senior accepts — is application-side, triggered by observing the column flip. A Route Handler at app/api/smugmug/quarantine is called from the client right after a flag-with-quarantine submission and again after a senior accept/delete on Flag Review. Idempotent in case of partial failure (the SmugMug move is the side effect; the DB is already correct). On failure, the DB and SmugMug get out of sync — surface a one-off "sync drift" warning in the next sync_log entry rather than blocking the user. The folder in SmugMug may need to be created if a quarantined image has never been flagged for that folder yet. It should be set to unlisted.
8.8 — Tests + seed cleanup
A new e2e SQL test, e2e_smugmug_sync_flow.sql, covering: (1) a clean-slate sync inserts the expected rows, (2) a re-run is a no-op, (3) photos missing from SmugMug get deleted if unreviewed and preserved if reviewed, (4) re-parenting works, (5) priority ordering is respected by the reviewer queue, (6) mode-switch clear-the-queue deletes only unreviewed pending rows.
The existing 20260505000013_seed_dev_data.sql placeholder photos either get deleted outright or guarded behind a "dev-only" check so production doesn't ship placeholder-IMG_4823 rows. The other e2e tests (e2e_review_flow, e2e_flag_review_flow) currently hard-code those smugmug_image_id values; update them to use a parameterized fixture or to insert their own fixture rows in the test transaction.
Deferred to V2
A smugmug_observations table that the nightly sync appends to — one row per photo ever seen, with smugmug_image_id, first_seen_at, last_seen_at, and the camp_week_id at the time. This unlocks "what did we miss in summer 2024" reporting that survives SmugMug's own reorganization of historical photos. For V1, the same question is answerable with degraded fidelity by comparing SmugMug's current state against reviews, which is fine for the recent-season cases where the question actually matters.


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
- **Year folders inside SmugMug locations are not modeled.** SmugMug nests `Location → Year (2025/2026) → Camp Week`; our schema goes `Location → Camp Week` directly. Year is recoverable from `camp_weeks.starts_on`. The SmugMug import job (step 8) walks year folders as a pass-through layer.
- **Review trigger functions are `SECURITY DEFINER`.** They run as the function owner so the inner UPDATEs on `photos` / `profiles` aren't filtered by the caller's RLS context. Anytime you write a trigger that mutates an RLS-protected table, mark it `security definer set search_path = public` or it'll fail silently in production. See the RLS gotcha below for the bug this fixes.
- **`Role` enum in code uses `reviewer` (not `staff`).** The DB enum is `('reviewer', 'senior', 'admin')`; the code matches it. The friendly label "Staff Reviewer" is preserved in `ROLE_LABEL.reviewer`.
- **No runtime feature toggles in V1.** Confetti is always on; leaderboard / streaks are deferred to a post-V1 release. The multiplier-bonus pennant *is* on, but it's data-driven (off when no bonus is enabled and active) — not a global feature flag.
- **Points Multiplier Bonus is fully DB-backed.** `bonus_periods` is its own multi-row table — `mode` discriminates recurring (days[] + HH:MM clock window) vs. one-time (timestamptz pair); `multiplier` is `numeric(4,2)` with a 1.10–10.00 check. The reviewer client passes an explicit `pointsAwarded = base × multiplier` into `submitReview` so `reviews.points_awarded` snapshots the bonused value the reviewer saw. The trigger's `points_config` lookup is the fallback for non-bonused write paths (senior accept / delete on FlagReview). Pennant re-evaluates on a 30s tick so windows start/end mid-session.
- **Theme is per-user; accent stays global; density removed.** `profiles.theme` (`('light','dark')` CHECK) backs the per-user picker on the Profile screen. `app_settings.accent` is the brand color, set by admins on Admin → Settings. Density was never wired (no `data-density` attribute, no compact CSS rules) — wiring it well isn't worth the work for an internal tool.
- **Admin Overview merged with Users.** One screen showing the reviewer roster with per-user stats (reviewed, points, last active, role, team), plus a small `Reviewed today` / `Active reviewers` stat row above the table. The standalone Users screen is gone — its search lives on the merged Overview header. The queue-depth panel is deferred until SmugMug data is wired in step 8.
- **Team is a free-form label on `profiles.team`, not an access boundary.** It's a string admins set on the Overview row editor for grouping in the roster. It does **not** gate which photos a reviewer sees, which camp weeks they have access to, or which queue rows they're served. If teams ever need to drive anything (notification routing, reporting splits), normalize to a `teams` table at that point — but the current column is descriptive only.
- **No invitations.** Workspace OAuth already gates sign-in to `@idtech.com`; the `handle_new_user` trigger creates the profile on first login. There is no invite link, no `pending_invites` table, no pre-assigned role/team.
- **No assignment system, full stop.** The product does not assign specific photos, camp weeks, locations, or queues to specific reviewers, seniors, or teams. Reviewers and Senior Reviewers see the **same** pending queue ordered the same way; the only role-based difference is that Seniors (and Admins) additionally see Flag Review and can write `delete` decisions. There is no `assignments` table, no `assigned_to` column, no team-to-location mapping, no round-robin or per-user batch slicing, and no auto-reassignment on idle. The original AdminAssignment screen was a mock that persisted nothing; step 7.7f refactored it into a `SmugMugImport` placeholder shell (admin-only) that step 8 will flesh out. The `senior_routing_rules` table (migration 8) is **notification routing on flag insert**, not assignment — it does not gate which photos seniors can see.
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
