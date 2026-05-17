-- Migration 26 — Triage refactor demolition.
--
-- Strips the marketing-review surface (reviews, review_tags, points_config,
-- bonus_periods, examples, senior_routing_rules, reviewer_stats view, all
-- four review triggers, the example-images storage bucket, the dead
-- reviewer-copy columns on app_settings, photos.current_status /
-- photos.priority, smugmug_config.queue_order, tags.kind) while preserving
-- the SmugMug-sync foundation (divisions, locations, camp_weeks, photos,
-- smugmug_config, sync_log) and the auth + branding scaffolding.
--
-- See spec/REFACTOR_INVENTORY.md for the rationale on every surface that
-- moves here, and spec/TRIAGE_SPEC.md §8 for the migration ordering this
-- file implements. The new triage schema lands in migration 27; new
-- triggers + RLS in migration 28 (both still pending Step 2 clarifications).
--
-- This migration is irreversible. Roll forward — there is no down-migration.
-- Run with:
--   npx supabase db push --linked

-- ─── 1. Drop the view that depends on reviews ───────────────────────────────
-- Must precede the reviews drop or Postgres refuses with "cannot drop because
-- other objects depend on it" (would require CASCADE, which we avoid here in
-- favor of explicit ordering).

drop view if exists public.reviewer_stats;

-- ─── 2. Drop the four review triggers + their functions ─────────────────────
-- Function drops have to come *after* the table drops because the triggers
-- are dependent objects; dropping the table removes the trigger and frees
-- the function. We drop reviews further down (§4) so we hold these here.

-- Triggers vanish with their tables in §4, so we don't issue explicit
-- drop trigger statements — the function drops below are what matter.

-- ─── 3. Drop senior_routing_rules ───────────────────────────────────────────
-- No dependents; standalone table.

drop table if exists public.senior_routing_rules;

-- ─── 4. Drop reviews + review_tags + their triggers + their functions ──────
-- Order: review_tags first (it FKs reviews), then reviews. Functions drop
-- after because they're owned by the trigger that lived on reviews.

drop table if exists public.review_tags;
drop table if exists public.reviews;

drop function if exists public.reviews_snapshot_points();
drop function if exists public.reviews_update_photo_status();
drop function if exists public.reviews_update_quarantine();
drop function if exists public.reviews_bump_last_active();

-- ─── 5. Drop points_config ──────────────────────────────────────────────────

drop table if exists public.points_config;

-- ─── 6. Drop bonus_periods + its trigger + its enum ─────────────────────────
-- Trigger vanishes with the table; function drop after; enum last.

drop table if exists public.bonus_periods;
drop function if exists public.bonus_periods_touch_updated_at();
drop type if exists public.bonus_period_mode;

-- ─── 7. Drop examples + reorder RPC + example-images storage bucket ────────
-- RPC first (it references the example_kind enum we drop in step 8); then
-- the storage policies + bucket; then the table; then the enum.

drop function if exists public.reorder_examples(example_kind, uuid[]);

drop policy if exists example_images_select_authenticated on storage.objects;
drop policy if exists example_images_insert_admin         on storage.objects;
drop policy if exists example_images_update_admin         on storage.objects;
drop policy if exists example_images_delete_admin         on storage.objects;

-- Hosted Supabase rejects direct DELETE on storage.objects / storage.buckets
-- (SQLSTATE 42501 — use Storage API or Dashboard). Policies above are gone;
-- the example-images bucket may linger empty until manually removed.

drop table if exists public.examples;
drop type  if exists public.example_kind;

-- ─── 8. Drop the dead reviewer-copy columns on app_settings ─────────────────
-- Branding columns (brand_name, brand_tagline, brand_mark, accent,
-- favicon_storage_path, support_email) stay. The five reviewer-flow copy
-- columns went obsolete with HomeScreen / ReviewScreen / SessionComplete.

alter table public.app_settings
  drop column if exists home_greeting,
  drop column if exists home_subtitle,
  drop column if exists completion_title,
  drop column if exists completion_message,
  drop column if exists empty_queue_message;

-- ─── 9. Drop smugmug_config.queue_order + the queue_order enum ─────────────

alter table public.smugmug_config drop column if exists queue_order;
drop type if exists public.queue_order;

-- ─── 10. Drop photos.priority + its partial index + photos.current_status ──
-- Index first (defensive — the column drop would auto-drop it, but being
-- explicit makes the intent clearer in diffs). Then priority. Then
-- current_status. Then the photo_status enum that current_status referenced.

drop index if exists public.photos_pending_priority_idx;

alter table public.photos drop column if exists priority;
alter table public.photos drop column if exists current_status;
drop type if exists public.photo_status;

-- ─── 11. Reseed tags: drop kind column + enum, truncate the table ──────────
-- review_tags is already gone (§4), so the on-delete-restrict FK from
-- review_tags.tag_id no longer blocks the truncate. The new ops-rubric
-- tags get seeded in migration 27.

alter table public.tags drop column if exists kind;
drop type  if exists public.tag_kind;
truncate table public.tags;

-- ─── 12. Enum swap for sync_kind ────────────────────────────────────────────
-- Remove the dead values 'priority_add' and 'mode_switch' (their producers,
-- /api/smugmug/prioritize and /api/smugmug/clear-pending, are deleted in
-- this same chunk). Add 'triage_sample' proactively so migration 28's
-- triage sample-burst cron writes audit rows without needing a second
-- enum swap later.
--
-- Postgres doesn't let you drop enum values in place. The canonical move
-- is: clear any rows holding the dead values, create the new enum, ALTER
-- the column type using a text round-trip cast, drop the old enum, rename
-- the new one back. Pre-clearing rows is what makes the cast safe.

delete from public.sync_log where kind in ('priority_add', 'mode_switch');

create type public.sync_kind_v2 as enum (
  'scheduled', 'manual', 'quarantine_move', 'triage_sample'
);

alter table public.sync_log
  alter column kind type public.sync_kind_v2
  using kind::text::public.sync_kind_v2;

drop type public.sync_kind;
alter type public.sync_kind_v2 rename to sync_kind;

-- ─── 13. Drop the decision enum (table that used it is gone) ───────────────

drop type if exists public.decision;

-- ─── End ────────────────────────────────────────────────────────────────────
-- Surfaces preserved post-migration:
--   tables:      profiles, divisions, locations, camp_weeks, photos, tags,
--                app_settings, smugmug_config, sync_log
--   views:       camp_weeks_with_status
--   enums:       role, profile_status, smugmug_mode, sync_status, sync_kind
--   triggers:    handle_new_user (on auth.users)
--   functions:   is_admin, is_senior_or_admin, handle_new_user
--   buckets:     branding-assets
--   policies:    everything on the surfaces above (untouched)
