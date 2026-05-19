# Triage Refactor — Demolition Inventory

> Archived — refactor complete. Preserved for archaeology only; do not treat as current.

## 0. Framing

This document covers **only the demolition side** of the refactor. Tables, screens, and library code that the new triage app will *add* are listed here only by name where they replace something being deleted; their actual schema, transitions, and UI live in Step 2's `TRIAGE_SPEC.md`.

Marketing-review functionality is being **stripped cleanly**, not dormant-flagged. Git history preserves anything we want to reference later. The SmugMug folder/photo sync layer is the foundation triage builds on and is preserved entirely — every `lib/smugmug/*` file, every `app/api/smugmug/*` route except `prioritize` and `clear-pending` (which serve the dead reviewer queue concept), the `divisions/locations/camp_weeks/photos/smugmug_config/sync_log` tables, the SmugMug `Image.Hidden` quarantine primitive.

Classification used throughout:

- **DROP** — delete entirely. Nothing in the new app needs it.
- **KEEP** — file/table/column survives unchanged (or with only trivial edits like removing dead imports).
- **MODIFY** — survives but loses or gains columns / props / behavior; the file/table stays at the same path/name.
- **REBUILD** — same conceptual slot but the file's contents get fully rewritten. Treated as a delete + new file at the same path so reviewers don't try to read old code as a starting point.

---

## 1. Database — tables, views, enums, functions, RLS

### 1a. Tables to DROP entirely

| Table | Created in | Why it goes | Cascade considerations |
|---|---|---|---|
| `reviews` | [`20260505000006_reviews_and_triggers.sql`](../supabase/migrations/20260505000006_reviews_and_triggers.sql) | Core marketing-review decision log (approve / flag / delete with rating + points). Triage records only "this reviewer triaged this photo and applied these flags" — semantically different and the immutable-decision model doesn't carry over. | `review_tags.review_id` cascades. Drop `review_tags` first. |
| `review_tags` | same migration | Junction for review→tag. Triage will need its own junction (`triage_photo_tags` or similar — Step 2) but the existing rows mean different things (positive-tag-on-approve vs. flag-tag-on-flag) and can't be migrated meaningfully. | `tags.id` is referenced by `review_tags` with `on delete restrict` — won't block once `review_tags` is gone, but order matters. |
| `points_config` | [`20260505000007_config_tables.sql`](../supabase/migrations/20260505000007_config_tables.sql) | Singleton points-per-decision config. Score model in triage is simple per-reviewer count; no per-action point values. | None — referenced only by the (also being dropped) `reviews_snapshot_points` trigger. |
| `bonus_periods` | [`20260506000017_bonus_periods.sql`](../supabase/migrations/20260506000017_bonus_periods.sql) | Multiplier-bonus schedule. No multipliers, no leaderboard, no points in triage. | None. Drop the `bonus_period_mode` enum with it. |
| `examples` | [`20260505000007_config_tables.sql`](../supabase/migrations/20260505000007_config_tables.sql); `storage_path` added in [`20260506000018_examples_storage.sql`](../supabase/migrations/20260506000018_examples_storage.sql) | The "good/bad photo examples" library is review-rubric training material. Triage has its own ops rubric; examples library doesn't carry over. | The `reorder_examples` RPC + the `example-images` Storage bucket + its `storage.objects` policies also go (see §1d / §1g). |
| `senior_routing_rules` | [`20260505000008_senior_routing_rules.sql`](../supabase/migrations/20260505000008_senior_routing_rules.sql) | Tag-trigger fan-out to seniors on flag insert. Triage has no flag-routing concept (there's one senior surface per camp_week and seniors self-select). Was deferred to Step 11 originally; that step is now obsolete in its current form. | None. |

### 1b. Tables to KEEP but MODIFY

| Table | What survives | What gets dropped | What gets added in Step 2 (named here for forward reference only) |
|---|---|---|---|
| `profiles` ([`20260505000002_profiles.sql`](../supabase/migrations/20260505000002_profiles.sql), `theme` from [`20260507000020_per_user_theme.sql`](../supabase/migrations/20260507000020_per_user_theme.sql)) | `id`, `email`, `full_name`, `role`, `team`, `status`, `theme`, `created_at`, `last_active_at`. The `handle_new_user` trigger and the auto-create flow stay. **Explicit note:** `profile_status` enum + `profiles.status` are **kept**, but become **write-dead** between Step 1 demolition and the Step 2 triage-side activity trigger — nothing flips `active` → `idle` → `inactive` in the interim (the original wiring was deferred to the now-obsolete Step 11). This is a temporary gap, not a deletion. | Nothing on the table itself; the `reviews_bump_last_active` trigger that updates `last_active_at` goes (replaced by a triage equivalent that bumps on triage flag insert; same trigger or a sibling will be the new producer of `profiles.status` transitions). | A denormalized `triaged_count` column is a Step 2 design choice (vs. computing on the fly) — not committed yet. |
| `photos` ([`20260505000005_photos.sql`](../supabase/migrations/20260505000005_photos.sql); `priority` from [`20260507000021_smugmug_config_and_sync_log.sql`](../supabase/migrations/20260507000021_smugmug_config_and_sync_log.sql)) | All SmugMug-sync columns: `id`, `camp_week_id`, `smugmug_image_id`, `smugmug_url`, `image_url`, `thumbnail_url`, `caption`, `captured_at`, `width`, `height`, `smugmug_folder_id`, `is_quarantined`, `created_at`, `updated_at`. **`is_quarantined` and the `photos_is_quarantined_idx` partial index are explicitly kept** — the brief doesn't surface a quarantined-queue view, but the column is the contract the existing `/api/smugmug/quarantine` + `runQuarantineReconcile` pipeline reads, and a senior "show me everything currently quarantined" list is plausible enough to want a cheap index already in place. | `current_status` (`pending`/`approved`/`flagged`/`deleted` is review-only). `priority` + the partial index `photos_pending_priority_idx` (queue prioritization was for the global pending review queue; triage queue is camp_weeks, not photos). | A `triage_state` column (`not_required` / `pending` / `in_progress` / `clean` / `flagged`) — Step 2 will also decide whether this lives on `photos` (default plan per brief) or on a `camp_week_triage_photos` join table (see §6 pushback). |
| `camp_weeks` ([`20260505000003_folder_hierarchy.sql`](../supabase/migrations/20260505000003_folder_hierarchy.sql)) | Everything: `id`, `location_id`, `name`, `smugmug_folder_id`, `starts_on`, `ends_on`, `created_at`. The `camp_weeks_dates_idx` and the `camp_weeks_with_status` view stay. | Nothing. | Triage-related columns (state, role-as-1st-vs-2nd, signoff metadata, signoff-by, signoff-at, recheck-flagged-at, positive assessments) — Step 2. |
| `locations` ([`20260505000003_folder_hierarchy.sql`](../supabase/migrations/20260505000003_folder_hierarchy.sql)) | Everything: `id`, `division_id`, `name`, `smugmug_folder_id`, `created_at`. | Nothing. | An `evergreen_notes` text column (admin-editable, reviewer-visible during triage) — Step 2. |
| `divisions` ([`20260505000003_folder_hierarchy.sql`](../supabase/migrations/20260505000003_folder_hierarchy.sql); `synced` from [`20260507000022_divisions_synced.sql`](../supabase/migrations/20260507000022_divisions_synced.sql)) | Everything. `synced` is still meaningful — the deep walk still gates on it. | Nothing. | Nothing in scope. |
| `tags` ([`20260505000004_tags.sql`](../supabase/migrations/20260505000004_tags.sql)) | `id`, `label`, `display_order`, `active`, `created_at`. | `kind` column (the `positive`/`negative` discriminator is review-specific). The seeded tags themselves: drop the 4 positives (`great-moment`, `hero-shot`, `group-energy`, `caption-worthy`) outright; the 13 negatives are review-flag tags, not ops-rubric tags — drop and reseed with the ops rubric (Step 2). **Implementation note:** the demolition migration does `truncate table public.tags` (issued *after* `review_tags` is gone so the `on delete restrict` FK doesn't fire) rather than a `delete from ... where id in (...)`. This explicitly clears any manually-inserted dev/test rows along with the seeded ones, leaving a guaranteed-empty table for the ops-rubric reseed. | Either no `kind` (single bucket) or a triage-specific `kind` enum (e.g. `category`: brand / safety / setup / quality) — Step 2. |
| `app_settings` ([`20260505000007_config_tables.sql`](../supabase/migrations/20260505000007_config_tables.sql); extended in [`20260506000016_app_settings_extension.sql`](../supabase/migrations/20260506000016_app_settings_extension.sql) and [`20260506000019_branding_favicon.sql`](../supabase/migrations/20260506000019_branding_favicon.sql)) | Branding: `brand_mark`, `brand_name`, `brand_tagline`, `accent`, `favicon_storage_path`, `support_email`, `updated_at`. | Reviewer-copy template fields: `home_greeting`, `home_subtitle`, `completion_title`, `completion_message`, `empty_queue_message`. They templated the marketing-review batch UX (`{name}`, `{count}`) and don't apply to the camp-week-claim UX. | Step 2 will decide whether triage's yearly setup (1st-week window, max_for_triage, triage start time, claim expiry duration) extends `app_settings` or moves to its own `triage_config` singleton. |
| `smugmug_config` ([`20260507000021_smugmug_config_and_sync_log.sql`](../supabase/migrations/20260507000021_smugmug_config_and_sync_log.sql)) | `id`, `mode`, `season_start_date`, `earliest_fetch_date`, `last_sync_at`, `last_sync_status`, `updated_at`. The settings card + edit modal stay in `AdminSmugMug.tsx`. **Note:** `mode` + the `smugmug_mode` enum (`summer` \| `off_season`) are kept as a placeholder for the future quality-review spec; no current code consumes the distinction post-refactor (the sync handlers read `season_start_date` / `earliest_fetch_date` directly), but the columns + enum stay so the future spec doesn't have to recreate them. | `queue_order` (`newest_first`/`oldest_first` was for the marketing-review queue ordering; triage iterates photos within a claim by upload time, direction TBD in Step 2). The mode-switch confirm dialog goes with `/api/smugmug/clear-pending`. | Nothing on the table itself. |
| `sync_log` ([`20260507000021_smugmug_config_and_sync_log.sql`](../supabase/migrations/20260507000021_smugmug_config_and_sync_log.sql)) | Everything: `id`, `started_at`, `finished_at`, `kind`, `status`, `photos_*` counters, `error_summary`, `triggered_by`. | Drop the `priority_add` and `mode_switch` values from the `sync_kind` enum (their producers are being removed). `quarantine_move` stays. `scheduled` and `manual` stay. | Possibly a new `triage_sample` kind for the Tuesday-burst sampler audit row — Step 2. |

### 1c. Placeholder migrations — leave as-is

[`20260505000010_badges_placeholder.sql`](../supabase/migrations/20260505000010_badges_placeholder.sql), [`20260505000011_streaks_placeholder.sql`](../supabase/migrations/20260505000011_streaks_placeholder.sql), [`20260505000012_activity_log_placeholder.sql`](../supabase/migrations/20260505000012_activity_log_placeholder.sql) are comment-only SQL files that create nothing. They were reserved for post-V1 gamification (badges, streaks, recent activity) — all gamification is being dropped, so those tables will never be created. Leave the migration files in place (they're already applied as no-ops; deleting them rewrites history and gains nothing).

**Step 2 must add an explicit note in `PROJECT_CONTEXT.md`: migration numbers `20260505000010`, `20260505000011`, and `20260505000012` are dead slots and MUST NOT be reused — not for repurposed gamification, not for "we ended up wanting a badges table after all", not for anything. Any future gamification work (badges, streaks, activity log) gets brand-new migration numbers at the time it lands.** Reusing a number whose file content is comment-only-now-different-comment is the kind of thing that confuses everyone six months later and breaks any out-of-band tooling that hashes migration content.

### 1d. Views to DROP

| View | Migration | Why |
|---|---|---|
| `reviewer_stats` | [`20260506000015_reviewer_stats_view.sql`](../supabase/migrations/20260506000015_reviewer_stats_view.sql) | Aggregates approves/flags/deletes/points from `reviews`. All four source columns disappear with `reviews`. Triage's per-user "photos triaged" count is a different shape and gets its own view/RPC in Step 2. |

### 1e. Views to KEEP

| View | Migration | Notes |
|---|---|---|
| `camp_weeks_with_status` | [`20260505000003_folder_hierarchy.sql`](../supabase/migrations/20260505000003_folder_hierarchy.sql) | Still useful — computes `is_active` from `starts_on`/`ends_on`. Triage UI may want the same boolean ("is this week running right now") for the camp-week list filters. |

### 1f. Functions / triggers to DROP

All four review triggers (and their backing functions) defined in [`20260505000006_reviews_and_triggers.sql`](../supabase/migrations/20260505000006_reviews_and_triggers.sql) and hardened in [`20260505000014_fix_review_triggers_security.sql`](../supabase/migrations/20260505000014_fix_review_triggers_security.sql):

- `reviews_snapshot_points()` + `tg_reviews_snapshot_points`
- `reviews_update_photo_status()` + `tg_reviews_update_photo_status`
- `reviews_update_quarantine()` + `tg_reviews_update_quarantine`
- `reviews_bump_last_active()` + `tg_reviews_bump_last_active`

Plus:
- `bonus_periods_touch_updated_at()` + `tg_bonus_periods_touch_updated_at` ([`20260506000017_bonus_periods.sql`](../supabase/migrations/20260506000017_bonus_periods.sql))
- `reorder_examples(example_kind, uuid[])` RPC ([`20260506000018_examples_storage.sql`](../supabase/migrations/20260506000018_examples_storage.sql))

### 1g. Functions / triggers to KEEP

- `handle_new_user()` + `on_auth_user_created` ([`20260505000002_profiles.sql`](../supabase/migrations/20260505000002_profiles.sql)) — auto-create profile on Google OAuth signup; not review-related.
- `is_admin()`, `is_senior_or_admin()` ([`20260505000009_rls_policies.sql`](../supabase/migrations/20260505000009_rls_policies.sql)) — generic role helpers used by RLS across kept tables (and by the SmugMug API routes).

Triage will introduce its own triggers for `photos.triage_state` maintenance and `camp_weeks` state transitions — Step 2.

### 1h. Enums

DROP: `decision`, `tag_kind`, `photo_status`, `example_kind`, `bonus_period_mode` (with `bonus_periods`).

KEEP: `role`, `profile_status`, `smugmug_mode`, `sync_status`.

MODIFY: `sync_kind` — remove `priority_add` and `mode_switch`; keep `scheduled`, `manual`, `quarantine_move`. (Postgres can't drop enum values trivially; in practice this is "create a new enum and swap" in the demolition migration — Step 2's migration ordering will handle it.)

DROP, ambiguous: `queue_order`. Currently lives on `smugmug_config.queue_order` and is read by the reviewer queue ordering. In triage, photos within a claim still need deterministic order. Provisionally drop the enum + column; Step 2 will decide whether to reintroduce a setting on the new triage config or hardcode the order.

### 1i. RLS policies to DROP

Every policy on a dropped table goes with the table. Specifically: all policies on `reviews`, `review_tags`, `points_config`, `bonus_periods`, `examples`, `senior_routing_rules`. From `storage.objects`: `example_images_select_authenticated` and the three admin-write policies scoped to the `example-images` bucket.

### 1j. RLS policies to KEEP / REVIEW

All other policies in [`20260505000009_rls_policies.sql`](../supabase/migrations/20260505000009_rls_policies.sql) stay (profiles, divisions, locations, camp_weeks, photos, tags, app_settings, smugmug_config, sync_log, branding-assets storage). Step 2 will need to *add* new policies for new tables (triage state, claims, signoffs, location notes) and revisit the "service role only" write rule on `photos` if triage flips `triage_state` from authenticated client code (vs. via SECURITY DEFINER trigger).

### 1k. Storage buckets

- DROP `example-images` bucket ([`20260506000018_examples_storage.sql`](../supabase/migrations/20260506000018_examples_storage.sql)) — its sole consumer is the examples library which is being removed.
- KEEP `branding-assets` bucket ([`20260506000019_branding_favicon.sql`](../supabase/migrations/20260506000019_branding_favicon.sql)) — favicon survives.

---

## 2. UI — screens and shell

### 2a. Screen files to DROP entirely

| File | Why |
|---|---|
| [`components/screens/ReviewScreen.tsx`](../components/screens/ReviewScreen.tsx) | 10-photo session, approve/flag/rating/positive-tags/quarantine UX. Pure marketing-review. |
| [`components/screens/FlagReview.tsx`](../components/screens/FlagReview.tsx) | Senior flag queue, accept/delete on individual flagged photos. Triage's senior surface is the per-camp-week dashboard, not a per-photo flag review queue. |
| [`components/screens/LeaderboardProfileGuide.tsx`](../components/screens/LeaderboardProfileGuide.tsx) | Contains `ProfileScreen` (career points + approve/flag/delete breakdown) and `GuideScreen` (30-second rubric + examples). Both review-coupled. Profile slot may come back later for triage; rebuild from scratch if/when needed (brief: "We can add visibility for reviewers themselves later if it becomes useful"). |
| [`components/screens/HomeScreen.tsx`](../components/screens/HomeScreen.tsx) | Greeting + bonus banner + thumb strip + "Start reviewing" CTA. Templating logic and CTA are review-specific; rebuild at the same path with a triage hub (camp-weeks-needing-triage list). |

### 2b. Screens to KEEP but heavily MODIFY/REBUILD

| File | Modification |
|---|---|
| [`components/screens/Admin.tsx`](../components/screens/Admin.tsx) | Barrel file exporting multiple admin screens. **DROP** the `AdminPoints` (per-action points + bonus + tag library + decorative "Live impact"), `AdminExamples` (good/bad upload grid), and any review-rubric sections. **KEEP** the `AdminOverview` shell (roster + search + edit modal) but rewire its stats source from the dropped `reviewer_stats` view to the new triage-count surface (Step 2). **MODIFY** `AdminSettings`: keep Branding + Logo & favicon + Brand color + Live preview cards; drop the Reviewer copy / Completion / Empty-states cards. **KEEP** the `SmugMugImport` re-export. **ADD** placeholders for new screens (triage yearly setup, locations evergreen notes, triage tag library) — full design in Step 2. |
| [`components/screens/AdminSmugMug.tsx`](../components/screens/AdminSmugMug.tsx) | **KEEP** Settings card + edit modal (minus the mode-switch "clear the queue" 3-button dialog), Sync now action, Sync log card. **DROP** Prioritize action + modal (no global photo queue), Queue list card (no global photo queue), the pending-photo tree-picker counts. |

### 2c. Shell / infrastructure components

| File | Disposition | Notes |
|---|---|---|
| [`components/App.tsx`](../components/App.tsx) | **MODIFY** | Rip out `BonusPeriodsProvider`, screen-id routing for `review` / `flag-review` / `profile` / `guide` / `admin-points` / `admin-examples`. Pending-count fetch (`fetchPendingCount`) goes. New screen ids land in Step 2 (camp-weeks-list, claim, senior dashboard, triage-config, evergreen-notes editor). |
| [`components/Shell.tsx`](../components/Shell.tsx) | **MODIFY** | Drop `BonusPennant` + `useActiveBonusPeriod` (no bonus). Drop `fetchFlaggedCount` import + the senior "Flag review" sidebar badge. Sidebar nav entries restructured: reviewer sees "Triage" + (later) optional Profile; senior sees a senior dashboard link; admin sees rebuilt admin nav. Confetti + toast stack + `PageHeader` + `BrandLogo` survive. |
| [`components/settings.tsx`](../components/settings.tsx) | **MODIFY** | **KEEP** `SettingsProvider`/`useSettings` (DB-backed app_settings, favicon, accent). **DROP** `BonusPeriodsProvider`, `useBonusPeriods`, `activeBonusPeriod`, `formatBonusWindow`, `formatBonusMultiplier`. `fillTemplate` is currently consumed *only* by the five reviewer-copy fields (`home_greeting`, `home_subtitle`, `completion_title`, `completion_message`, `empty_queue_message`) via `{name}` / `{count}` substitution — once those fields are dropped (§1b `app_settings`), `fillTemplate` has zero call sites. **Provisional call: drop `fillTemplate` along with the reviewer-copy fields.** If Step 2's triage copy design wants templated strings (e.g. "Triage 1st-week photos for {location} ({count} unclaimed)"), reintroduce it as a fresh helper alongside the new copy fields — it's ~10 lines. Retention is *speculative* otherwise; default to delete. |
| [`components/Icon.tsx`](../components/Icon.tsx) | **KEEP** | Inline SVG set. A handful of icons (`review`, `star`, etc.) become unused; can be pruned during Step 3 polish or left for now (no harm). |
| [`components/PhotoImg.tsx`](../components/PhotoImg.tsx) | **KEEP** entirely | Generic SmugMug-URL image renderer; triage grid will reuse it. |

### 2d. App router files

| File | Disposition |
|---|---|
| [`app/layout.tsx`](../app/layout.tsx) | **KEEP**. SSR metadata reads `app_settings` for title + favicon — both columns survive. |
| [`app/page.tsx`](../app/page.tsx) | **KEEP** (just renders `<App />`). |
| [`app/login/page.tsx`](../app/login/page.tsx) | **KEEP**. Google OAuth sign-in. |
| [`app/auth/callback/route.ts`](../app/auth/callback/route.ts) | **KEEP**. OAuth code exchange. |
| [`middleware.ts`](../middleware.ts) + [`lib/supabase/middleware.ts`](../lib/supabase/middleware.ts) | **KEEP**. Session refresh + auth gating. The `/api/smugmug/sync-scheduled` cron whitelist stays. |

---

## 3. Library code (`lib/`)

### 3a. DROP entirely

| File | Why |
|---|---|
| [`lib/reviews.ts`](../lib/reviews.ts) | `fetchPendingPhotos`, `fetchPendingCount`, `fetchFlaggedPhotos`, `fetchFlaggedCount`, `fetchRecentPhotoThumbs`, `submitReview` — every export is review-flow. |
| [`lib/points-config.ts`](../lib/points-config.ts) | Reads `points_config` table; provides `basePointsFor`. Both dead. |
| [`lib/bonus-periods.ts`](../lib/bonus-periods.ts) | Reads/writes `bonus_periods` table. Dead. |
| [`lib/examples.ts`](../lib/examples.ts) | Reads/writes `examples` table + `example-images` Storage bucket. Dead. |
| [`lib/profile.ts`](../lib/profile.ts) | `fetchMyStats`, `fetchReviewerRoster`, `updateReviewerProfile` — backed by `reviewer_stats` view. The role/team writes are still useful, but rebuilding the file on top of a new triage-count surface (Step 2) is cleaner than carving out one function. |
| [`lib/queue-list.ts`](../lib/queue-list.ts) | Admin paginated pending-photo queue with priority filter. Whole concept dies with the global review queue. |

### 3b. KEEP entirely

| File | Why |
|---|---|
| [`lib/supabase/client.ts`](../lib/supabase/client.ts), [`lib/supabase/server.ts`](../lib/supabase/server.ts), [`lib/supabase/service.ts`](../lib/supabase/service.ts), [`lib/supabase/middleware.ts`](../lib/supabase/middleware.ts) | Generic Supabase plumbing. Untouched. |
| [`lib/current-user.tsx`](../lib/current-user.tsx) | `UserProvider`, `useCurrentUser`, `useUpdateTheme`, `Role`/`Theme` types, `ROLE_LABEL`. Auth/profile/theme — generic. |
| [`lib/app-settings.ts`](../lib/app-settings.ts) | Settings IO + favicon upload/remove + `brandingAssetUrl`. **MODIFY** the `DbAppSettings` type to drop the five reviewer-copy fields (`homeGreeting`, `homeSubtitle`, `completionTitle`, `completionMessage`, `emptyQueueMessage`) once the columns are dropped; everything else stays. Treating this as "keep" because the file's shape and exports are stable — the modification is removing fields, not rewriting. |
| [`lib/smugmug-config.ts`](../lib/smugmug-config.ts) | Read/write `smugmug_config`. **MODIFY** to drop `queue_order` from the typed shape once the column is dropped (§1b/§1h). Same "keep" caveat as above. |
| [`lib/sync-log.ts`](../lib/sync-log.ts) | Reads `sync_log` joined to `profiles`. Sync log stays. |
| [`lib/quarantine-trigger.ts`](../lib/quarantine-trigger.ts) | Thin client wrapper `triggerQuarantineMove(photoId)` → POST `/api/smugmug/quarantine`. **Justification for keeping:** triage still needs a quarantine action for unsafe content (brief calls it "the only non-tag action"). The whole quarantine pipeline (client trigger → API route → `runQuarantineReconcile` → `setImageHidden` → `sync_log`) is content-neutral about whether the trigger came from a marketing flag or a triage flag. The only thing keeping this file marketing-coupled is its current callers (`ReviewScreen`, `FlagReview`); both go, but the new triage grid + senior dashboard call it instead. No changes to the file itself. **Caveat:** "no changes" is contingent on Step 2 preserving the `Image.Hidden`-driven quarantine contract (i.e. `photos.is_quarantined` stays on the `photos` table as the canonical signal, `runQuarantineReconcile` keeps reading it, and the API route's shape stays the same). If any of that changes — e.g. quarantine moves to a join table, or the SmugMug-side primitive switches back to an album move — this file gets re-reviewed at that point. |
| [`lib/smugmug/*`](../lib/smugmug/) — `index.ts`, `fetch.ts`, `oauth.ts`, `types.ts`, `nodes.ts`, `albums.ts`, `images.ts`, `users.ts`, `quarantine.ts`, `smugmug-config.ts`, plus all of `lib/smugmug/sync/*` (`types.ts`, `concurrency.ts`, `dates.ts`, `walker.ts`, `reconcile.ts`, `photos.ts`, `quarantine.ts`) | Folder + photo sync foundation. Triage is *built on* this; nothing in here knows about reviews. Untouched. |
| [`lib/tags.ts`](../lib/tags.ts) | **MODIFY**, not drop. Triage still needs a tag library (the ops-rubric flags are tags). Surface to drop: `partitionActiveTags` (no more positive/negative split). Surface to keep/rename: `fetchTags`, `createTag`, `setTagActive`, `deleteTag`, `slugifyTagId`, `buildTagLabelLookup`. Whether the `kind` parameter survives depends on Step 2's tag-bucket decision; provisionally drop it. |

### 3c. Missing from repo

Per exploration: no `lib/data.tsx` (already deleted), no `app/api/smugmug/download/route.ts`, no `app/api/smugmug/image/route.ts`. The README's project-structure block still mentions `components/data.tsx` — fix during Step 3 docs rewrite.

---

## 4. API routes (`app/api/`)

| Route | Disposition | Why |
|---|---|---|
| [`app/api/smugmug/ping/route.ts`](../app/api/smugmug/ping/route.ts) | **KEEP** | Admin smoke endpoint for SmugMug credentials. |
| [`app/api/smugmug/sync-folders/route.ts`](../app/api/smugmug/sync-folders/route.ts) | **KEEP** | Folder-tree reconcile (divisions/locations/camp_weeks). Foundation. |
| [`app/api/smugmug/sync-now/route.ts`](../app/api/smugmug/sync-now/route.ts) | **KEEP** | Manual photo sync. Foundation. |
| [`app/api/smugmug/sync-scheduled/route.ts`](../app/api/smugmug/sync-scheduled/route.ts) | **KEEP** | Cron photo sync (daily Vercel Cron from [`vercel.json`](../vercel.json)). Foundation. |
| [`app/api/smugmug/quarantine/route.ts`](../app/api/smugmug/quarantine/route.ts) | **KEEP** | Fire-and-forget `Image.Hidden` PATCH. Reusable for triage quarantine. |
| [`app/api/smugmug/prioritize/route.ts`](../app/api/smugmug/prioritize/route.ts) | **DROP** | Sets `photos.priority = 1` for the global pending review queue. Both the column and the queue are dead. |
| [`app/api/smugmug/clear-pending/route.ts`](../app/api/smugmug/clear-pending/route.ts) | **DROP** | Deletes unreviewed pending photos on mode switch. Both the trigger UX and the `pending` review status are dead. (If Step 2 decides triage needs a similar "reset sample state for this week" admin action, it'll be a new route with different semantics — not a rename of this one.) |

Step 2 will add new routes for: claim/release a camp_week or slice, apply triage flags, request a triage resample for a week, senior signoff (good-to-go / flag-2nd-week-for-recheck), evergreen notes write. Not in scope here.

---

## 5. Tests, scripts, docs, config

### 5a. Tests under `supabase/tests/`

| File | Disposition |
|---|---|
| [`supabase/tests/e2e_review_flow.sql`](../supabase/tests/e2e_review_flow.sql) | **DROP**. Exercises the entire approve/flag review flow under RLS. |
| [`supabase/tests/e2e_flag_review_flow.sql`](../supabase/tests/e2e_flag_review_flow.sql) | **DROP**. Senior flag-resolution flow. |
| [`supabase/tests/e2e_reviewer_stats.sql`](../supabase/tests/e2e_reviewer_stats.sql) | **DROP**. Asserts the `reviewer_stats` view shape. |
| [`supabase/tests/e2e_smugmug_sync_flow.sql`](../supabase/tests/e2e_smugmug_sync_flow.sql) | **KEEP with edits.** Pure DB-contract test for the sync engine; no review semantics. Six scenarios all stay valid after `photos.current_status` and `photos.priority` are dropped — one or two assertions will need to be updated to drop the priority-ordering / status-exclusion checks. The file survives; the edits are surgical. |
| [`supabase/tests/smoke_test.sql`](../supabase/tests/smoke_test.sql) | **REBUILD**. Current schema-smoke test exercises review triggers and constraints heavily. Rewrite around the new triage schema (Step 2/3). |

### 5b. Scripts

| File | Disposition |
|---|---|
| [`supabase/scripts/reset_to_post_import.sql`](../supabase/scripts/reset_to_post_import.sql) | **DROP**. Resets `reviews`/`review_tags` + flips `photos.current_status` back to `pending` — all three referenced surfaces are going away. Step 3 will add a triage equivalent if useful ("reset all in-flight triage state on a week"). |

### 5c. Spec docs

| File | Disposition |
|---|---|
| [`spec/PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) | **REBUILD** in Step 2 (explicit deliverable). Most of "What this app is", roadmap, decisions-already-made, Step 11 notifications backbone, and Phase-2 notes need to be rewritten or removed. |
| [`spec/SCHEMA_SPEC.md`](./SCHEMA_SPEC.md) | **DROP** in Step 2 once `TRIAGE_SPEC.md` lands. The new spec covers the new schema; keeping the old one around invites confusion. Git history preserves it. |
| [`spec/STEP_9_SPIKE_NOTES.md`](./STEP_9_SPIKE_NOTES.md) | **KEEP**. Captures the Next 15 LTS upgrade decisions; still relevant. |
| [`README.md`](../README.md) | **REBUILD** in Step 3. The "Reviewing photos", "Roles", "Flag review", "Example library", and project-structure sections are all review-flavored. |

### 5d. Other config — KEEP unchanged

[`vercel.json`](../vercel.json) (cron config), [`next.config.mjs`](../next.config.mjs), [`tailwind.config.ts`](../tailwind.config.ts), [`postcss.config.mjs`](../postcss.config.mjs), [`tsconfig.json`](../tsconfig.json), [`.eslintrc.json`](../.eslintrc.json), [`middleware.ts`](../middleware.ts), [`styles/legacy.css`](../styles/legacy.css) — none of these encode review semantics. Some `legacy.css` classes will become unused; cleanup is Step 3 polish.

---

## 6. Ambiguous / borderline cases — surfaced for your call

These are items where I made a provisional call above but want to flag the reasoning so you can override before Step 2 starts. None of them affect Step 1 (the demolition is the same regardless); they affect what Step 2 designs.

1. **`queue_order` enum + `smugmug_config.queue_order` column.** Provisional call: drop both, with photos-within-a-claim order hardcoded in Step 2. Counter-argument: keeping the column gives the triage UI a cheap admin-tunable knob for "oldest upload first" vs. "newest upload first" within a claim (relevant to catching duplicate-cluster issues per the brief). Lift cost is one column + ~10 lines of TS. *Recommendation: drop and reintroduce on a new triage config table if Step 2 design wants it — keeps the SmugMug-import surface clean.*

2. **`tags.kind` column.** Provisional call: drop. The ops rubric flags are all the same kind ("things to notice"). Counter-argument: a categorical split — e.g. `category`: `brand` / `safety` / `setup` / `quality` — would let the senior rollup group flags by category for faster scanning ("3 safety, 12 brand, ..."). *Recommendation: drop the current `positive`/`negative` `kind` column unconditionally as part of demolition; reintroduce a categorical column in Step 2 if the senior dashboard rollup wants it.*

3. **`lib/quarantine-trigger.ts` and the quarantine API route.** Marked **KEEP**. Already justified in §3b — the SmugMug-side primitive (`Image.Hidden`) and the DB-side trigger pattern are content-neutral. The one thing that *would* break this reuse is if Step 2 chooses not to maintain `photos.is_quarantined` (e.g. moves quarantine state to a join table). I'd argue against that move on the grounds that it forces a needless trigger rewrite; keeping `is_quarantined` on `photos` is the right call. *Flag: confirm in Step 2.*

4. **Two state machines (1st week + 2nd week recheck) vs. one unified.** Brief asked for pushback. My take: **one unified state machine on `camp_weeks`** with a `triage_role` discriminator (`first_week` / `second_week_recheck` / `none`) is cleaner. The transition sets do differ (1st week has `senior_review` + `complete`; 2nd week has `flagged_for_recheck` + `recheck_complete`), but they share `*_in_progress` + a terminal "this triage cycle is done" state. Discriminating by role lets RLS, the camp-weeks-needing-triage list query, the rollup queries, and the per-camp-week dashboard all read one column. Two state machines means duplicate triggers, duplicate queries with a `union all`, and duplicate UI. *Not a demolition decision; flag for Step 2.*

5. **`photos.triage_state` vs. a `camp_week_triage_photos` join table.** Brief asked for pushback. My take: **column on `photos` is right** as long as triage is one cycle per photo (brief implies this). A photo can only ever be in one triage context — its camp_week — so the relationship is 1:1, and a join table just adds an indirection. Join table makes sense only if triage might recur on the same photo across multiple weeks, which the model excludes (recheck triages *its own* 2nd-week photos, not the 1st-week ones). *Not a demolition decision; flag for Step 2.*

6. **1st-week-from-window-on-`starts_on` robustness.** Brief asked for pushback. The derivation works as long as every "real" 1st week has its `starts_on` in the configured window AND is the earliest qualifying week at its location. Edge cases: makeup weeks, training weeks, two weeks starting on the same day, locations whose first session starts before the window. My take: add an `is_first_week_override` boolean column on `camp_weeks` (nullable / tri-state if you want "force not first week" too) and have the derivation check overrides first. Costs a column and a tiny bit of admin UI; gives you a safety valve when the window heuristic misfires. *Not a demolition decision; flag for Step 2.*

7. **Score-by-count.** Brief asked for pushback. I'd ship it. The risk is "reviewer triaged 200 easy photos and skipped the hard ones" but there's no per-photo difficulty signal in the brief, no leaderboard pressuring people to game it, and admins are the only audience. If it becomes a problem, layering an "% of claimed photos triaged" denominator on top is cheap. *Not a demolition decision; flag for Step 2.*

8. **Placeholder migrations 10/11/12.** Provisional call: leave alone. They're already applied no-ops; removing the files rewrites history with no upside. *Flag: confirm.*

---

## 7. Summary counts

- **Tables dropped:** 6 (`reviews`, `review_tags`, `points_config`, `bonus_periods`, `examples`, `senior_routing_rules`).
- **Tables kept/modified:** 9 (`profiles`, `photos`, `camp_weeks`, `locations`, `divisions`, `tags`, `app_settings`, `smugmug_config`, `sync_log`).
- **Views dropped:** 1 (`reviewer_stats`). **Kept:** 1 (`camp_weeks_with_status`).
- **Enums dropped:** 5 (`decision`, `tag_kind`, `photo_status`, `example_kind`, `bonus_period_mode`); **modified:** 1 (`sync_kind`); **kept:** 4 (`role`, `profile_status`, `smugmug_mode`, `sync_status`). Drop `queue_order` provisionally per §6.
- **Functions/triggers dropped:** 5 (4 review triggers + bonus-periods-touch + `reorder_examples` RPC).
- **Storage buckets dropped:** 1 (`example-images`); **kept:** 1 (`branding-assets`).
- **Screens dropped:** 4 (`ReviewScreen`, `FlagReview`, `LeaderboardProfileGuide`, `HomeScreen`).
- **Screens kept/modified:** 2 (`Admin`, `AdminSmugMug`) + 5 shell/infrastructure files.
- **Lib files dropped:** 6 (`reviews`, `points-config`, `bonus-periods`, `examples`, `profile`, `queue-list`).
- **Lib files kept (some with minor type trims):** 8 (`current-user`, `app-settings`, `tags`, `smugmug-config`, `sync-log`, `quarantine-trigger`, all of `lib/supabase/*`, all of `lib/smugmug/*`).
- **API routes dropped:** 2 (`prioritize`, `clear-pending`); **kept:** 5 (`ping`, `sync-folders`, `sync-now`, `sync-scheduled`, `quarantine`).
- **Tests dropped:** 3 (`e2e_review_flow`, `e2e_flag_review_flow`, `e2e_reviewer_stats`); **kept (with minor edits):** 1 (`e2e_smugmug_sync_flow`); **rebuilt:** 1 (`smoke_test`).
- **Scripts dropped:** 1 (`reset_to_post_import.sql`).
- **Spec docs to rebuild/replace in later steps:** `PROJECT_CONTEXT.md`, `SCHEMA_SPEC.md` (→ `TRIAGE_SPEC.md`), `README.md`.

---

## 8. What's NOT in this inventory (defer to Step 2)

- New tables (triage state on `photos`, claims, signoffs, location notes, possibly a triage config singleton, possibly a per-camp-week positive assessments structure).
- Migration ordering for the refactor (drops first, then adds, then triggers — sequence will be designed alongside the new schema).
- Trigger logic for `photos.triage_state` maintenance (resync, week state changes, late uploads, max_for_triage reduced mid-week).
- New API routes (claim/release, apply triage flag, request resample, senior signoff, evergreen notes write).
- New screens (camp-weeks-needing-triage list, claim/triage grid, senior per-camp-week dashboard, admin triage-config screen, admin evergreen-notes editor).
- The state machine itself, in full detail.

These all belong to Step 2's `spec/TRIAGE_SPEC.md`.
