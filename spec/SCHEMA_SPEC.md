# iD Photo Reviewer — Database Schema Spec (Step 5 + step-6 fixes)

> **Status: implemented.** This document was originally the brief for step 5 and is now the reference for what's actually in the database. The schema lives in `supabase/migrations/20260505000001_*.sql` through `supabase/migrations/20260507000025_*.sql`, applied to the work-account Supabase project (`idtech-photo-reviewer`). The few places where the implementation diverges from the original brief are called out inline with **`Implementation note`** blocks.
>
> **Two material changes since the original step-5 brief landed:**
>
> 1. **Trigger security context.** Migration 14 marks all four review trigger functions `security definer`. The originals ran as the invoker and were silently zero-rowed by RLS on real client inserts (they bypass it under the service role, which is what `supabase db query` defaults to — so the schema-level smoke test missed it). See "Triggers" below.
> 2. **Dev seed data.** Migration 13 seeds the four real top-level SmugMug divisions plus a placeholder location/camp-week/photos chain under "iD Tech Camps → Adelphi University → May 25–29, 2026" so the app can exercise the schema before SmugMug ingest lands in step 8. Every placeholder row's `smugmug_*_id` starts with `placeholder-` for easy swap-in or deletion.

---

## What this schema needs to support

The app has two operating purposes that share one data model:

1. **Public-facing pipeline.** Reviewers triage photos uploaded to SmugMug by camp directors, marking them `approve` (great for parents) or `flag` (a senior should look). Photos are public by default; the only time a flag affects parent visibility is when the reviewer explicitly checks "quarantine" on a flag — in which case the photo's SmugMug `Image.Hidden` flag is flipped to `true` so it stops appearing in public album views and search until a senior resolves it.
2. **Internal QA pipeline.** During the camp week (typically Tuesdays), senior reviewers look at incoming photos to spot brand/setup/safety issues. They use the same flag mechanism as everyone else; tags like `off-brand` route notifications to the right specialist senior. Acting on the underlying ops issue happens outside this app.

There are three roles: `reviewer` (default), `senior`, and `admin`. Seniors do everything reviewers do plus they can resolve flags by approving (re-rating, re-tagging) or deleting. Admins additionally manage tags, examples, points, routing rules, and app settings.

---

## Relationship map at a glance

```
auth.users ──1:1── profiles
                      │
                      │ reviewer_id
                      ▼
divisions ──1:N── locations ──1:N── camp_weeks ──1:N── photos ──1:N── reviews ──N:M── tags
                                                                          │
                                                                          ▼
                                                                     review_tags

senior_routing_rules ─── tag_triggers (text[]) → references tag ids
                     └── recipient_id → profiles

points_config         (single-row config table)
app_settings          (single-row config table)
bonus_periods         (multi-row schedule for Points Multiplier Bonus)
examples              (admin-managed example library)
smugmug_config        (single-row SmugMug import settings — step 8.2)
sync_log              (audit trail of SmugMug sync runs — step 8.2)
```

---

## Enums (define first)

```sql
create type decision      as enum ('approve', 'flag', 'delete');
create type role          as enum ('reviewer', 'senior', 'admin');
create type profile_status as enum ('active', 'idle', 'inactive');
create type tag_kind      as enum ('positive', 'negative');
create type photo_status  as enum ('pending', 'approved', 'flagged', 'deleted');
create type example_kind  as enum ('good', 'bad');
```

Notes:
- `photo_status` is the photo's *workflow* state. Visibility (`is_quarantined`) is a separate dimension — a `flagged` photo may or may not be quarantined.
- `decision` covers all three actions a person can take on a photo. There is no separate "accept" decision; a senior bringing a flagged photo back is just performing `approve` (with rating + tags, same as any reviewer).

Migration 17 (sub-step 7.6d) added a `bonus_period_mode` enum (`recurring` \| `one-time`) used by `bonus_periods`. Migration 21 (step 8.2) added four SmugMug-import enums (`smugmug_mode`, `queue_order`, `sync_kind`, `sync_status`) used by `smugmug_config` and `sync_log` — see those table sections for membership. Migration 23 (step 8.7) appended `quarantine_move` to `sync_kind` for the per-photo SmugMug visibility-toggle audit trail; the originally-planned `quarantine_album_key` column on `smugmug_config` was added by 23 and dropped again by migration 24 once the implementation simplified to `Image.Hidden` and no longer needed a cached album.

---

## Folder hierarchy (mirrors SmugMug, kept in sync via import job)

### `divisions`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `name` | text not null | The four real ones are "iD Tech Camps", "iD Teen Academies", "Online Private Lessons", "Virtual Tech Camps" — they're the top-level folders in SmugMug under the site homepage. The discovery endpoint may surface additional retired divisions sitting alongside these. |
| `smugmug_folder_id` | text not null unique | the SmugMug node id |
| `synced` | bool not null | `default false` (added in migration 22, step 8.3a). Admins flip this on the divisions whose subtrees should be deeply walked by photo sync (8.4). The two seeded camp divisions ("iD Tech Camps", "iD Teen Academies") are bootstrapped to `true` in the same migration; the two non-camp divisions stay false. The folder-tree sync (8.3b) walks every division at the top level regardless of this flag — it's only the deep walk + photo enumeration that respect it. |
| `created_at` | timestamptz | `default now()` |

### `locations`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `division_id` | uuid not null | fk → `divisions(id)` on delete cascade |
| `name` | text not null | The bare SmugMug folder name, e.g. "Adelphi University" — no city suffix, no division prefix |
| `smugmug_folder_id` | text not null unique | |
| `created_at` | timestamptz | |

### `camp_weeks`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `location_id` | uuid not null | fk → `locations(id)` on delete cascade |
| `name` | text not null | e.g. "Week 3" |
| `smugmug_folder_id` | text not null unique | |
| `starts_on` | date not null | |
| `ends_on` | date not null | |
| `created_at` | timestamptz | |

Index `camp_weeks_dates_idx` on `(starts_on, ends_on)` for date-range queries.

> **Implementation note (year folders).** SmugMug nests folders as `Site Homepage → Division → Location → Year (e.g. "2025", "2026") → Camp Week`. The schema collapses the year layer — `camp_weeks` is the direct child of `locations` because the year is recoverable from `starts_on`. The SmugMug import job in step 8 will walk year folders as a pass-through layer rather than persisting them as their own entity.

> **Implementation note (`is_active`).** The original brief had an `is_active` stored generated column defined as `current_date between starts_on and ends_on`. Postgres requires stored generated columns to use `IMMUTABLE` expressions and `current_date` is `STABLE` (it shifts with the session's transaction timestamp), so the column was rejected by the remote with `SQLSTATE 42P17`. To preserve the spec's intent without changing the column shape conceptually, the table exposes the boolean through a view:
>
> ```sql
> create view public.camp_weeks_with_status as
>   select *, (current_date between starts_on and ends_on) as is_active
>     from public.camp_weeks;
> ```
>
> App code reads `camp_weeks_with_status` whenever it wants the boolean. Writes still go to the base table.

---

## Photos

### `photos`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `camp_week_id` | uuid not null | fk → `camp_weeks(id)` on delete restrict |
| `smugmug_image_id` | text not null unique | dedupe key on import |
| `smugmug_url` | text | link to SmugMug page |
| `image_url` | text | full-resolution URL |
| `thumbnail_url` | text | smaller URL for grid views |
| `caption` | text | from SmugMug; replaces the prototype's `activity` field |
| `captured_at` | timestamptz | |
| `width` | int | |
| `height` | int | |
| `current_status` | photo_status not null | `default 'pending'` — maintained by trigger |
| `is_quarantined` | bool not null | `default false` — maintained by trigger |
| `smugmug_folder_id` | text | the SmugMug album the photo lives in (always its camp_week album — quarantine is now expressed as `Image.Hidden=true` on the SmugMug image, which doesn't move the image between albums). |
| `priority` | int not null | `default 0` (added in migration 21, step 8.2). The Admin → SmugMug → "Prioritize in queue" action (step 8.5) calls `/api/smugmug/prioritize` to bulk-set `priority = 1` on every pending photo under a picked division/location/camp_week so those rows float to the top of the reviewer queue. The 8.4 import job leaves it at 0 for scheduled adds. **No per-row unprioritize in V1** — the only reset is the mode-switch "clear the queue" dialog, which deletes all unreviewed pending photos so the next sync rebuilds at `priority = 0`. |
| `created_at` | timestamptz | `default now()` |
| `updated_at` | timestamptz | `default now()` |

Index on `(current_status, camp_week_id)` for the reviewer queue.
Index on `(is_quarantined)` for the senior's "quarantined queue" view.
Partial composite index `photos_pending_priority_idx` on `(priority desc, captured_at) where current_status = 'pending'` (migration 21) — supports the queue ordering `where current_status = 'pending' order by priority desc, captured_at <queue_order>` that 8.4 wires up. Restricted to pending so it stays small as terminal-status rows accumulate.

---

## Reviews — the immutable decision log

### `reviews`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `photo_id` | uuid not null | fk → `photos(id)` on delete cascade |
| `reviewer_id` | uuid not null | fk → `profiles(id)` on delete restrict |
| `decision` | decision not null | |
| `rating` | smallint | 1–5; only set when `decision = 'approve'` |
| `note` | text | optional; mainly used on flags |
| `quarantine` | bool not null | `default false` — only meaningful when `decision = 'flag'` |
| `points_awarded` | int not null | `default 0` — snapshotted from `points_config` at insert time so future rate changes don't rewrite history |
| `created_at` | timestamptz | `default now()` |

Constraints:
- `check (decision = 'approve' or rating is null)` — rating only on approves
- `check (decision = 'flag' or quarantine = false)` — quarantine only on flags

Index on `(photo_id, created_at desc)` so "the latest review for this photo" is fast.
Index on `(reviewer_id, created_at desc)` for profile/leaderboard queries.

### `review_tags`
| col | type | notes |
|---|---|---|
| `review_id` | uuid not null | fk → `reviews(id)` on delete cascade |
| `tag_id` | text not null | fk → `tags(id)` on delete restrict |
| pk | (review_id, tag_id) | |

---

## Tags

### `tags`
| col | type | notes |
|---|---|---|
| `id` | text pk | slug-style; keep the existing ones from `data.tsx` (`blurry`, `hero-shot`, `off-brand`, etc.) |
| `label` | text not null | display name |
| `kind` | tag_kind not null | positive (used on approves) or negative (used on flags) |
| `display_order` | int not null | `default 0` |
| `active` | bool not null | `default true` |
| `created_at` | timestamptz | |

Seed this table from the tag lists historically in `components/data.tsx`.

> **Implementation note (initial seed).** Migration `20260505000004_tags.sql` seeded 13 negatives verbatim from the now-removed `NEGATIVE_TAGS` constant plus 4 positives (`great-moment`, `hero-shot`, `group-energy`, `caption-worthy`). The 7 rose duplicates that used to live in `PHOTO_TAGS` were intentionally not seeded — they were short-label dupes of the negatives.

> **Implementation note (step 7.6a, May 2026).** Tags are now read from the DB at the app layer too: `lib/tags.ts → fetchTags` powers ReviewScreen's positive/negative chip lists, FlagReview's tag-id-to-label lookup (using `buildTagLabelLookup`, which includes inactive tags so historical flags still get pretty labels), and the Admin TagLibrary's create/remove flow. The old `NEGATIVE_TAGS` / `PHOTO_TAGS` / `negativeTagLabel` exports in `components/data.tsx` were deleted; if you need them, that file's git history has them. Admin writes go through Supabase under the existing `tags_write_admin` RLS policy. Hard delete is attempted first; the FK from `review_tags` (`on delete restrict`) makes that fail with `23503` whenever a tag has ever been used, in which case the UI falls back to `update tags set active = false`. App reads should always filter on `active = true` for reviewer-facing chips and ignore `active` when looking up labels for historical rows.

---

## Profiles

### `profiles`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | fk → `auth.users(id)` on delete cascade |
| `email` | text not null | |
| `full_name` | text | from Google profile |
| `role` | role not null | `default 'reviewer'` |
| `team` | text | Free-form label (Operations / Programs / Marketing / Support / etc.) — admin-set on the Overview row editor. **Descriptive only; not an access boundary.** It does *not* gate which photos a reviewer sees, which camp weeks they can review, or which queue rows they're served. Reviewers and Senior Reviewers always see the same global pending queue regardless of `team`. |
| `status` | profile_status not null | `default 'active'` |
| `theme` | text not null | `default 'light'` (check constraint `profiles_theme_chk` — `light` \| `dark`). Per-user appearance preference; added in migration 20 (step 7.7c). The `profiles_update_self` RLS policy from migration 9 already permits self-edits — its with-check restricts only `role` and `team`, so theme writes pass without policy changes. |
| `created_at` | timestamptz | `default now()` |
| `last_active_at` | timestamptz | `default now()` — bumped on every review insert |

Auto-create a `profiles` row on every `auth.users` insert via a trigger (standard Supabase pattern).

---

## Notification routing (on flag insert)

> **This is notification routing, not assignment.** `senior_routing_rules` controls which seniors get *pinged* when a flag with certain tags lands. It does **not** gate which photos a senior can see — every senior + admin reads the same Flag Review queue. There is no assignment table in this schema (no `assignments`, no `assigned_to`, no `team_assignments`) and none is planned.

### `senior_routing_rules`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | admin-friendly label, e.g. "Safety escalation" |
| `recipient_id` | uuid not null | fk → `profiles(id)` — the senior who gets the ping |
| `tag_triggers` | text[] not null | array of `tags.id`; rule fires when any flag has any of these tags |
| `channels` | text[] not null | subset of `{'email', 'slack', 'sms', 'inapp'}` |
| `active` | bool not null | `default true` |
| `created_at` | timestamptz | |

This table is read by the app on flag insert to decide who to notify. The actual sending of email/Slack/etc. is an application-layer concern, not in scope for the schema. Step 11 (notifications backbone) wires the admin UI for managing these rules; the table itself has been in the schema since migration 8.

---

## Configuration tables

### `points_config` (single-row)
Enforce single row with `id smallint pk default 1 check (id = 1)`.

| col | type | notes |
|---|---|---|
| `id` | smallint pk | always 1 |
| `approve_points` | int not null | `default 10` |
| `flag_points` | int not null | `default 15` |
| `delete_points` | int not null | `default 0` |
| `updated_at` | timestamptz | |

### `app_settings` (single-row)
Same single-row pattern. Migration 16 (sub-step 7.6c) extended this to cover everything in the runtime `AppSettings` type except `bonusPeriods` (which moved to its own table — see below).

| col | type | notes |
|---|---|---|
| `id` | smallint pk | always 1 |
| `brand_mark` | text | nullable; coerced to `""` on read |
| `brand_name` | text | nullable |
| `brand_tagline` | text | nullable |
| `home_greeting` | text not null | reviewer-facing — `{name}` placeholder substituted client-side |
| `home_subtitle` | text not null | `{name}` and `{count}` placeholders |
| `completion_title` | text not null | shown above the points total on completion |
| `completion_message` | text not null | shown under the title |
| `empty_queue_message` | text not null | shown on Home when no photos are pending |
| `support_email` | text not null | help link target |
| `accent` | text not null | `sun` \| `lake` \| `moss` \| `rose` (check constraint `app_settings_accent_chk`). The brand color — only "appearance" knob still global. |
| `favicon_storage_path` | text | path within the `branding-assets` bucket (added in migration 19). Nullable; NULL means no favicon configured and `app/layout.tsx → generateMetadata` emits no `<link rel="icon">`. |
| `updated_at` | timestamptz | |

The dead `show_leaderboard` column from the original migration 7 was dropped in migration 16 — the corresponding feature toggle was removed from `AppSettings` during the V1 scope refactor and nothing reads it. The `theme` and `density` columns were dropped in migration 20 (step 7.7c): theme moved to `profiles.theme` (per-user); density was never wired to a DOM hook or CSS rule and isn't worth implementing for an internal tool.

`lib/app-settings.ts` is the only client-side reader/writer; `SettingsProvider` (`components/settings.tsx`) hydrates from it on mount and writes back through it via `updateAppSettings`. AdminSettings debounces text-input writes (500ms idle + flush on blur) so a single edit doesn't fan out to dozens of round-trips. Favicon mutations bypass that path: `setFavicon(file | null)` on the provider routes through `lib/app-settings.ts → uploadFavicon` / `removeFavicon`, which orchestrate the Storage upload and the `favicon_storage_path` column update together (and clean up the old object on replace).

### `bonus_periods`
Multi-row table for the Points Multiplier Bonus schedule (migration 17, sub-step 7.6d). Replaces the previous localStorage-backed `bonusPeriods: BonusPeriod[]` slice on `AppSettings`.

| col | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `label` | text not null | display label; `default ''` |
| `mode` | bonus_period_mode not null | enum: `recurring` \| `one-time` |
| `days` | smallint[] not null | weekday set for recurring (Sun=0); empty for one-time |
| `start_time` | text not null | HH:MM, recurring only; `default '00:00'` |
| `end_time` | text not null | HH:MM, recurring only |
| `start_at` | timestamptz | one-time only |
| `end_at` | timestamptz | one-time only |
| `multiplier` | numeric(4,2) not null | bounded `1.10..10.00` |
| `enabled` | bool not null | `default true` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | bumped by `tg_bonus_periods_touch_updated_at` on update |

Mode-specific check constraints (`bonus_periods_recurring_complete`, `bonus_periods_onetime_complete`) enforce that the relevant fields are populated. The unused fields are kept on safe defaults so client code doesn't have to null-check based on mode.

`lib/bonus-periods.ts` exposes `fetchBonusPeriods` / `createBonusPeriod` / `updateBonusPeriod` / `setBonusPeriodEnabled` / `deleteBonusPeriod`. `BonusPeriodsProvider` in `components/settings.tsx` wraps those with optimistic-update React state.

**Why the trigger doesn't read this table.** The bonus window is evaluated in the *reviewer's local browser timezone* (admins schedule in their tz, reviewers see the pennant in theirs). Postgres triggers don't have a clean timezone context for the caller, so instead of reading `bonus_periods` server-side, the client passes an explicit `points_awarded = base × multiplier` into the `reviews` insert. The existing `reviews_snapshot_points` trigger's "fall back to `points_config` when caller didn't supply one" branch is the safety net for paths that never run through a bonus pennant (FlagReview senior accept/delete).

### `examples`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `kind` | example_kind not null | good / bad |
| `label` | text not null | |
| `note` | text | |
| `image_url` | text | resolved public URL of the storage object; populated by the app on insert/replace so consumers can read it without paying for an SDK call. Legacy escape hatch for hand-seeded rows that never had an uploaded file. |
| `storage_path` | text | path within the `example-images` bucket (added in migration 18). Nullable for backwards compatibility, but every row created through the AdminExamples UI has one. |
| `display_order` | int not null | `default 0` — admin-curated; written by `lib/examples.ts → reorderExamples` (single transactional RPC) |
| `active` | bool not null | `default true` |
| `created_at` | timestamptz | |

> **Implementation note (step 7.6b, May 2026).** The original migration-7 seed of 9 conceptual placeholder rows (labels only, no image files) was deleted by migration 18. The new model is "every example is a real uploaded image" — admins create them through the UI, which uploads to Supabase Storage and inserts a row pointing at the resulting object. `lib/examples.ts` is the single client-side reader/writer; both `AdminExamples` (admin UI) and `GuideScreen` (reviewer-facing) consume `fetchExamples()`. The reorder helper (`reorderExamples`) calls the `public.reorder_examples(example_kind, uuid[])` RPC so the new `display_order` for an entire kind is written in a single statement — the client doesn't have to fan out N parallel UPDATEs and risk a half-applied ordering on partial failure.

### `smugmug_config` (single-row, migration 21, step 8.2)
Single-row table backing the Admin → SmugMug screen's settings card. Same `id smallint pk default 1 check (id = 1)` pattern as `points_config` and `app_settings`.

| col | type | notes |
|---|---|---|
| `id` | smallint pk | always 1 |
| `mode` | smugmug_mode not null | `summer` \| `off_season`. Both modes use a single lower bound on `camp_weeks.starts_on` with no upper bound: in `summer`, the bound is `season_start_date` (the admin pins it to the first day of camp for the season); in `off_season`, the bound is `earliest_fetch_date` (admin-curated, used for archival-cleanup work between summers). The "newest week first" reviewer ordering falls out of `priority desc, captured_at <queue_order>` rather than any extra mode logic. |
| `season_start_date` | date | consulted in summer mode. Seeded to Jan 1 of the current year as a sensible default; the admin moves it to the actual first-day-of-camp when configuring for the season. |
| `earliest_fetch_date` | date | consulted in off-season mode. Nullable — only one of the two date columns is meaningful at a time. |
| `queue_order` | queue_order not null | `newest_first` \| `oldest_first`. Selects the `captured_at` direction for the reviewer queue's `order by priority desc, captured_at <dir>` clause. `default 'newest_first'`. |
| `last_sync_at` | timestamptz | mirrored from the most recent `sync_log.finished_at` for fast settings-card render. Maintained by the 8.4 sync handler. |
| `last_sync_status` | text | plain text (not the `sync_status` enum) so the summary line can carry richer context than the strict three-value membership — e.g. `"success · +147 photos"` or `"partial · 3 errors, see log"`. |
| `updated_at` | timestamptz | `default now()` |

RLS follows the established read-by-everyone / write-by-admins pattern (policies `smugmug_config_select_authenticated`, `smugmug_config_write_admin`). Seeded as `(1, 'summer', date_trunc('year', current_date)::date, 'newest_first')`.

### `sync_log` (multi-row, migration 21, step 8.2)
Append-only audit trail of SmugMug sync runs. Backs the sync-log table at the bottom of the Admin → SmugMug screen.

| col | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `started_at` | timestamptz not null | `default now()` |
| `finished_at` | timestamptz | nullable so an in-flight run can be `INSERT … RETURNING id` and updated when it completes |
| `kind` | sync_kind not null | `scheduled` \| `manual` \| `mode_switch` \| `priority_add` \| `quarantine_move`. `scheduled` is the daily Vercel Cron run; `manual` is the admin's "Sync now" button; `mode_switch` is the bulk-clear that runs when the admin switches mode and chose "clear the queue"; `priority_add` is the manual "Add folder to queue" path; `quarantine_move` (added migration 23, step 8.7) is one row per call to `/api/smugmug/quarantine` — both successful `Image.Hidden` toggles and SmugMug-side failures land here, so admins can spot drift on the Sync log card without instrumenting a separate surface. The legacy name comes from the original "move into a quarantine album" design that was abandoned for `Image.Hidden`; the audit semantics are preserved across the rename. |
| `status` | sync_status not null | `success` \| `partial` \| `failed`. `partial` covers per-photo errors that didn't sink the whole run. |
| `photos_added` | int not null | `default 0` |
| `photos_updated` | int not null | `default 0` |
| `photos_removed` | int not null | `default 0` — counts photos `DELETE`'d because they disappeared from SmugMug and had no review history. |
| `error_summary` | text | nullable; short human-readable text for the expandable row in the admin sync-log table. Full stack traces stay in Vercel logs. |
| `triggered_by` | uuid | fk → `profiles(id)` `on delete set null`. NULL for `scheduled` runs; set to the admin's id for the other three kinds. |

Index `sync_log_started_at_idx` on `(started_at desc)` for the table view.

RLS is **admin-read-only**: policy `sync_log_select_admin` permits `select` only when `public.is_admin()`. There is no authenticated write policy because all writes flow through the cron + manual sync handlers (8.4) running under the service role, which bypasses RLS by design — the auth check happens at the handler level *before* the service-role client is constructed, not at the database layer.

> **Implementation note (step 8.4 — run lifecycle).** `lib/smugmug/sync/photos.ts → runPhotoSync` writes each row in two passes: an INSERT up front with `started_at = now()` and a placeholder `status = 'success'`, then a single UPDATE on completion that sets `finished_at`, the real terminal `status` (`success` / `partial` / `failed`), the three counters, and `error_summary`. Two-pass means a hard failure mid-run (process killed, SmugMug auth blew up, etc.) still leaves a sync_log row with a populated `started_at` and a `finished_at IS NULL` — that's how the admin sync-log table (8.5) will detect "the run never finished" without inventing a fourth enum value. The same handler also writes `smugmug_config.last_sync_at` + `last_sync_status` (e.g. `"success · +147 ~3 -2"` or `"failed · season_start_date is NULL"`) so the Admin → SmugMug settings card can render the latest summary without joining `sync_log`.

### Storage

Two public-read / admin-write buckets, both following the same pattern (bucket-level `public = true` so reads can use plain public URLs, plus per-bucket RLS on `storage.objects` enforcing admin-only writes via `public.is_admin()`).

**`example-images`** holds the actual image files for the example library. Created by migration 18.

**`branding-assets`** holds admin-uploaded brand artifacts. Currently used for the favicon (one file per app, path stored in `app_settings.favicon_storage_path`); any future single-artifact brand uploads (header logo, login splash) would land here too. Created by migration 19.

For both buckets:

- **Public read.** Created with `public = true` so consumers (Guide screen for examples, browser favicon load for branding) can render via plain public URLs (`storage.from('<bucket>').getPublicUrl(path).data.publicUrl`) without signing. The app already gates everything behind sign-in via middleware, so unauthenticated users never see the URLs in the first place — except the favicon, which is intentionally accessible pre-auth so the browser tab icon loads on /login (it just isn't enumerable, which is fine).
- **Storage RLS** (separate from table RLS — both have to be set):
  - SELECT: any authenticated user (mirrors the bucket-level public read; the policy is what authenticated *clients* hit before the public-read kicks in).
  - INSERT / UPDATE / DELETE: admin only via `public.is_admin()`.
- **Path convention.** Each upload lands at `<uuid>.<ext>` — opaque, collision-free, and replacing an image lands at a fresh path so the browser cache is busted for free (no `?v=...` query string needed). The old object is deleted after the row update succeeds.
- **No second consumer yet.** The upload + cleanup-on-error pattern is currently only used by `lib/examples.ts`. If a second feature picks up Storage, lift the helpers (path generation, public URL resolution, upload-then-cleanup) into `lib/storage.ts`.

This is the first feature in the codebase that uses Supabase Storage. There's no separate config — the bucket lives in the same Supabase project as the rest of the schema.

---

## Triggers (described; Cursor implements)

> **All four review trigger functions below are `security definer set search_path = public`.** Migration 14 added that. Without it, the inner UPDATEs on `photos` and `profiles` are evaluated under the caller's RLS context — and `photos` has no UPDATE policy for authenticated users (writes are reserved for the SmugMug import job via the service role), so the updates were silently zero-rowed in production. `security definer` lets the trigger run with the function owner's privileges, the same way `is_admin()`, `is_senior_or_admin()`, and `handle_new_user()` already worked. Anytime you add a new trigger that mutates an RLS-protected table, follow the same pattern.

1. **`profiles` auto-creation on `auth.users` insert.** Standard Supabase pattern — copies `id`, `email`, and `full_name` (from `raw_user_meta_data`) into `profiles` with default role `reviewer`. Already `security definer` in migration 2.

2. **Maintain `photos.current_status` on `reviews` insert.**
   - `approve` → `'approved'`
   - `flag` → `'flagged'`
   - `delete` → `'deleted'`
   Also bump `photos.updated_at`.

3. **Maintain `photos.is_quarantined` on `reviews` insert.**
   - If `decision = 'flag'` and `quarantine = true` → set `is_quarantined = true`.
   - If `decision = 'approve'` or `decision = 'delete'` → set `is_quarantined = false`.
   - If `decision = 'flag'` and `quarantine = false` → leave `is_quarantined` unchanged (a non-quarantining flag doesn't change visibility).
   The actual SmugMug folder move is the **application's** responsibility, triggered by observing this column change. The trigger updates DB state only.

4. **Bump `profiles.last_active_at` on `reviews` insert** (set to `now()` for the row whose `id = NEW.reviewer_id`).

5. **Snapshot `points_awarded` on `reviews` insert** (only if the inserter didn't supply it). Look up `points_config` and copy the appropriate value based on `NEW.decision`. This is a safety net; the app should also pass it explicitly so writes are obvious in code.

---

## Row-Level Security (outline)

Enable RLS on every table. Default deny.

**`profiles`**
- `select`: any authenticated user can read all rows (needed for displaying reviewer names on reviews, leaderboard, etc.)
- `update`: a user can update their own row's display fields; `role` and `team` are admin-only
- `insert`/`delete`: admin only (or service role via the auto-create trigger)

**`photos`, `divisions`, `locations`, `camp_weeks`**
- `select`: any authenticated user
- `insert`/`update`/`delete`: service role only (these are written by the SmugMug import job, not by the app)

**`tags`, `examples`, `senior_routing_rules`, `points_config`, `app_settings`, `bonus_periods`, `smugmug_config`**
- `select`: any authenticated user
- `insert`/`update`/`delete`: admin role only (policy `bonus_periods_write_admin` mirrors the others — `using (public.is_admin()) with check (public.is_admin())`; `smugmug_config_write_admin` follows the same shape)

**`sync_log`**
- `select`: admin only (policy `sync_log_select_admin`)
- `insert`/`update`/`delete`: service role only (the SmugMug sync handlers in step 8.4 — `scheduled`, `manual`, `mode_switch`, `priority_add` — all run under the service role and bypass RLS; the admin auth check happens at the Route Handler level before the service-role client is constructed)

**`reviews`**
- `select`: any authenticated user (the leaderboard, profile, and admin overview all need broad read)
- `insert`:
  - Any authenticated user can insert with `decision in ('approve', 'flag')`
  - Only `senior` or `admin` can insert with `decision = 'delete'`
  - `reviewer_id` must match `auth.uid()` (prevents impersonation)
- `update`/`delete`: nobody (the log is immutable; mistakes get a new corrective review row)

**`review_tags`**
- Inherits effectively from `reviews` — same insert rules; nobody updates/deletes.

---

## Deferred — explicitly not in this schema (yet)

Empty placeholder migrations exist for the post-V1 gamification tables so the migration order is reserved:

- **`badges` and `user_badges`** — for an eventual Profile-screen achievement list (migration 10).
- **`streaks`** — for an eventual streak counter (migration 11).
- **`activity_log`** — denormalized feed for an eventual "Recent activity" panel; could also be derived from `reviews` + a few computed events (migration 12).

Step 11 (notifications backbone) will add a `notifications` table + a `notification_preferences` table at that point. Its purpose is narrow: reminders, nudges, role-change pings, and senior-routing fan-out from `senior_routing_rules` on flag insert — **not** assignment alerts. The existing `senior_routing_rules` table (migration 8) is the read side of that work; it stays untouched until step 11 wires a UI for managing rules. The in-app **notifications interface** (bell / dropdown / panel) is post-V1 work; see Phase 2 step 2 in `PROJECT_CONTEXT.md`.

Step 8 (SmugMug import) landed its schema in migration 21 — see `smugmug_config` and `sync_log` above, plus the new `priority` column on `photos`. The folder-priority concept the original V1 brief sketched as an `import_pool` table compressed down to a single `photos.priority` int — admin-curated "Add folder to queue" actions (8.5) just stamp `priority = 1` on the inserted rows, and the reviewer queue's `order by priority desc, captured_at` falls out for free without a separate join. This is folder-priority for the global queue; it is not per-reviewer or per-team — every reviewer + senior sees the same queue ordered the same way.

**Not planned.** No `assignments`, `assigned_to`, `team_assignments`, or similar table is on the roadmap. The product does not assign specific photos, camp weeks, locations, or queues to specific reviewers/seniors/teams. If that ever changes, the design starts here.

---

## Implementation order (as built)

Each step landed as its own migration file under `supabase/migrations/` so each is independently testable and the migration log mirrors the design narrative.

| File | Purpose |
|---|---|
| `20260505000001_enums.sql` | Six enums |
| `20260505000002_profiles.sql` | `profiles` + `handle_new_user` trigger on `auth.users` |
| `20260505000003_folder_hierarchy.sql` | `divisions` → `locations` → `camp_weeks` + `camp_weeks_with_status` view |
| `20260505000004_tags.sql` | `tags` + seed from `data.tsx` |
| `20260505000005_photos.sql` | `photos` (no triggers yet) |
| `20260505000006_reviews_and_triggers.sql` | `reviews`, `review_tags`, all four review triggers |
| `20260505000007_config_tables.sql` | `points_config`, `app_settings`, `examples` + seeds |
| `20260505000008_senior_routing_rules.sql` | `senior_routing_rules` |
| `20260505000009_rls_policies.sql` | RLS + `is_admin()` / `is_senior_or_admin()` helpers |
| `20260505000010_badges_placeholder.sql` | Empty placeholder; reserves migration ordering |
| `20260505000011_streaks_placeholder.sql` | Empty placeholder |
| `20260505000012_activity_log_placeholder.sql` | Empty placeholder |
| `20260505000013_seed_dev_data.sql` | Step 7.2: seeds the four real divisions, plus a placeholder location/week/photos chain (`smugmug_*_id` prefixed `placeholder-`). Idempotent. |
| `20260505000014_fix_review_triggers_security.sql` | Step 7.x: re-creates the four review trigger functions with `security definer set search_path = public`, plus a one-time backfill that reconciles any photo whose `current_status` had drifted from its latest review's decision while the bug was live. |
| `20260506000015_reviewer_stats_view.sql` | Step 7.5: adds the `public.reviewer_stats` view — a left join of `profiles` with aggregated `reviews` (count by decision, sum of points, max created_at, count where created_at >= current_date), zero-coalesced. Uses `with (security_invoker = true)` so RLS is enforced via the underlying tables' policies. Backs `lib/profile.ts → fetchMyStats / fetchReviewerRoster`. |
| `20260506000016_app_settings_extension.sql` | Step 7.6c: extends `app_settings` with the reviewer-copy strings, `support_email`, and the appearance triple (theme/accent/density) — backfills DEFAULT_SETTINGS values into the singleton row, then locks the new columns NOT NULL with check constraints. Drops the dead `show_leaderboard` column. Backs `lib/app-settings.ts` and the new `SettingsProvider` write path. |
| `20260506000017_bonus_periods.sql` | Step 7.6d: adds the `bonus_periods` table + the `bonus_period_mode` enum + RLS (read-all / write-admin). Includes mode-specific check constraints so recurring rows have a populated weekday set + clock window and one-time rows have a valid timestamptz pair. Backs `lib/bonus-periods.ts` and the new `BonusPeriodsProvider`. |
| `20260506000018_examples_storage.sql` | Step 7.6b: adds `examples.storage_path`, deletes the placeholder seeds from migration 7, creates the public `example-images` Storage bucket, adds storage.objects RLS policies (auth read; admin write), and adds the `public.reorder_examples(example_kind, uuid[])` RPC for atomic display-order updates. Backs `lib/examples.ts` and the rebuilt `AdminExamples` + `GuideScreen` UIs. |
| `20260506000019_branding_favicon.sql` | Step 7.7a: adds `app_settings.favicon_storage_path` (nullable) and creates the public `branding-assets` Storage bucket with the same dual-layer RLS pattern migration 18 used for `example-images` (auth read; admin write at both bucket and storage.objects layers). Backs the `uploadFavicon` / `removeFavicon` helpers in `lib/app-settings.ts`, `SettingsProvider.setFavicon`, the Favicon card in Admin → Settings, and the `<link rel="icon">` in `app/layout.tsx → generateMetadata`. |
| `20260507000020_per_user_theme.sql` | Step 7.7c: adds `profiles.theme` (`text not null default 'light'` + check `profiles_theme_chk` ∈ `('light','dark')`) and drops `app_settings.theme` / `app_settings.density` plus their named CHECK constraints. Theme is now per-user; density was never wired and is gone for good. The existing `profiles_update_self` RLS policy already permits self-edits — its with-check restricts only `role` and `team`, so theme writes pass without policy changes. Backs `lib/current-user.tsx` (now selects `role, theme` and exposes `useUpdateTheme`), `App.tsx` (applies `data-theme` from `useCurrentUser()`), the Brand-color card in Admin → Settings (accent only — Appearance card removed), and the new Appearance card on ProfileScreen. |
| `20260507000025_drop_placeholder_dev_data.sql` | Step 8.8: deletes the placeholder photos (`smugmug_image_id like 'placeholder-IMG_%'`), placeholder camp week, and placeholder location seeded by migration 13 — by step 8 they're dev scaffolding that shouldn't ship alongside real SmugMug data. The four placeholder *divisions* stay because the 8.3 folder sync rewrites their `smugmug_folder_id` in place once it discovers the real ids. LIKE filters on the `placeholder-` prefix are production-safe: rows already reconciled by 8.3 no longer match. Reviews on placeholder photos cascade-delete via the `reviews.photo_id` FK. |

Five tests live under `supabase/tests/` (deliberately outside `migrations/` so they aren't applied by `db push`). All five are transactions wrapped in `begin; ... rollback;`:

| File | Role context | What it covers |
|---|---|---|
| `smoke_test.sql` | service role (default) | Schema-level: enums, hierarchy FKs, trigger basics, both check constraints |
| `e2e_review_flow.sql` | service role for fixture seed → `authenticated` + pinned JWT for review inserts | Reviewer flow: approve + flag, all four triggers, both check constraints, RLS context as in production. Step 8.8: now seeds its own division/location/week/photo fixtures up front (in service role, before the role pin) instead of depending on migration 13's placeholder photos. |
| `e2e_flag_review_flow.sql` | service role for fixture seed → `authenticated` + pinned JWT for review inserts | Senior flow: flag transition, the FlagReview join shape, accept-after-flag, delete. Step 8.8: self-seeds fixtures, same pattern as above. |
| `e2e_reviewer_stats.sql` | service role for fixture seed → `authenticated` + pinned JWT for review inserts | `reviewer_stats` view shape: row-count parity with `profiles`, no NULL aggregates, and delta assertions on insert (totals, decisions, points, reviewed_today, last_reviewed_at). Step 8.8: self-seeds fixtures, same pattern as above. |
| `e2e_smugmug_sync_flow.sql` | service role | Step 8.8: validates the database contract the SmugMug sync engine relies on. Six scenarios — clean-slate insert, re-run no-op (no UPDATE without drift, unique constraint blocks duplicate insert), orphan handling (unreviewed deleted / reviewed preserved), re-parenting (camp_week_id moves rather than duplicating), reviewer-queue ordering (priority desc, captured_at <queueOrder>, non-pending excluded), mode-switch clear-the-queue (only unreviewed pending deleted). |

```bash
npx supabase db query --file supabase/tests/<file>.sql --linked
```

The last row of each is a sentinel string (`smoke test passed`, `e2e review flow passed`, `flag review flow passed`, `reviewer stats view passed`, `e2e smugmug sync flow passed`). Anything else means a `raise exception` triggered — read the error to find which assertion fired.

> **Don't write new client-flow tests as the service role.** `supabase db query` defaults to running as the postgres/service role, which **bypasses RLS entirely**. The original `smoke_test.sql` ran this way and missed the trigger-vs-RLS bug fixed by migration 14 because the service role had update privileges on `photos`. The three `e2e_*` tests now `set local role authenticated; set local request.jwt.claims to '{"sub": "<uid>", "role": "authenticated"}';` so RLS is enforced as in production. Keep that pattern for any test that simulates the app's own writes.

After each migration: `npm run build`, push to GitHub. The build doesn't exercise the schema directly, but confirms nothing in the codebase regressed. The schema is now exercised end-to-end by step 7's app code (sub-steps 7.1–7.5 done as of the last working session — see `PROJECT_CONTEXT.md`'s roadmap for what's left).

---

## Open questions for the user (none blocking — just to surface)

- Is `team` going to be a free-text field on `profiles`, or should it be its own `teams` table? Free text is fine for now; can normalize later. *Implemented as free text per the original recommendation.*
- Are notification channels going to be all four (`email`/`slack`/`sms`/`inapp`) on day one, or should we cut sms/slack until those integrations actually exist? Schema supports all four; the app can ignore unsupported ones. *Implemented as `text[]` with a non-empty constraint; the app filters to whichever channels are wired up.*
- Should `delete` reviews preserve any record of the photo's `image_url` for post-deletion auditing, or is "the row exists with `decision = 'delete'`" enough? Current spec is the latter. *Implemented as the latter.*

---

## Apply / verify (operational)

The repo is linked to the Supabase project via `npx supabase link`; `supabase/.temp/` (gitignored) holds the link metadata. There's no `supabase/config.toml` and no `supabase init` was run — the goal was to keep the repo lean.

```bash
npx supabase db push --dry-run                                       # preview migrations
npx supabase db push                                                 # apply
npx supabase db query --file supabase/tests/smoke_test.sql --linked  # verify
```

Two operational gotchas worth knowing if the smoke test ever needs editing:

1. `set local session_replication_role = replica;` skips FK enforcement **and every user-defined trigger** in the same transaction. The four review triggers are exactly what the smoke test is meant to verify, so don't reach for that setting. Drop the FK temporarily inside the transaction instead — DDL is transactional in Postgres, so the script's trailing `rollback;` restores the constraint automatically.
2. Inside a single transaction, `now()` (the default for `reviews.created_at`) returns the transaction's start time, identical for every row. `order by created_at desc limit 1` is therefore non-deterministic across rows inserted in the same transaction. The smoke test filters by `decision` instead. New assertions should follow the same pattern.
