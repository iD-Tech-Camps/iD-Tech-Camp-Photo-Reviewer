-- Step 8.2 — SmugMug import schema
--
-- Lands every column and table the SmugMug ingestion pipeline (8.3 / 8.4 / 8.5)
-- will read or write before any code references them. No application changes
-- ride along with this migration; it's a pure schema land.
--
-- Three new pieces:
--
--  1. public.smugmug_config — singleton (id = 1, same pattern as
--     points_config / app_settings) carrying the operational mode and the
--     last-sync summary that the Admin → SmugMug screen renders.
--
--  2. public.photos.priority — int, default 0, indexed. The reviewer queue
--     ordering becomes `ORDER BY priority DESC, captured_at <queue_order>`
--     once 8.4 wires it up; manual "Add folder to queue" entries write
--     priority = 1 so they jump to the top.
--
--  3. public.sync_log — append-only audit trail of every sync run
--     (scheduled cron, manual button, mode-switch clear, priority add).
--     Reads are admin-only; writes flow through the cron Route Handler in
--     8.4 under the service role, which bypasses RLS by design.
--
-- The photo_status enum is intentionally untouched. Photos that leave the
-- queue without a review (mode-switch bulk-clear, or disappeared from
-- SmugMug) are DELETE'd outright in 8.4; photos with at least one review
-- row stay in whatever terminal state their last review left them, the
-- same way they always have. No new enum value is needed for either path.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
create type smugmug_mode as enum ('summer', 'off_season');
create type queue_order  as enum ('newest_first', 'oldest_first');
create type sync_kind    as enum ('scheduled', 'manual', 'mode_switch', 'priority_add');
create type sync_status  as enum ('success', 'partial', 'failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- smugmug_config (singleton)
--
-- season_start_date is consulted in summer mode; earliest_fetch_date is
-- consulted in off-season mode. Both are nullable because only one is
-- meaningful at a time and the admin sets the relevant one when configuring.
--
-- last_sync_status is plain text rather than the sync_status enum so the
-- summary line can carry richer context (e.g. "success · +147 photos") for
-- the settings card without forcing every value through the enum membership.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.smugmug_config (
  id                   smallint primary key default 1,
  mode                 smugmug_mode not null default 'summer',
  season_start_date    date,
  earliest_fetch_date  date,
  queue_order          queue_order not null default 'newest_first',
  last_sync_at         timestamptz,
  last_sync_status     text,
  updated_at           timestamptz not null default now(),

  constraint smugmug_config_singleton check (id = 1)
);

-- Sensible defaults: summer mode pinned to Jan 1 of the current year.
-- The admin will move season_start_date to the actual first-day-of-camp once
-- they configure for the season; Jan 1 just keeps the column non-NULL for
-- queries that always want a date in summer mode.
insert into public.smugmug_config
  (id, mode, season_start_date, queue_order)
values
  (1, 'summer', date_trunc('year', current_date)::date, 'newest_first');

-- ─────────────────────────────────────────────────────────────────────────────
-- photos.priority
--
-- The partial composite index targets the actual reviewer-queue query plan:
-- `where current_status = 'pending' order by priority desc, captured_at`.
-- A plain b-tree on priority alone would be valid but would force the
-- planner to do a separate captured_at sort on every queue read. Restricting
-- to pending keeps the index small (terminal-status photos never appear
-- in the queue).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.photos
  add column priority int not null default 0;

create index photos_pending_priority_idx
  on public.photos (priority desc, captured_at)
  where current_status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_log
--
-- One row per sync run. Scheduled runs leave triggered_by NULL; manual,
-- mode-switch, and priority-add runs set it to the admin who clicked the
-- button. error_summary is short human-readable text suitable for the
-- expandable row in the admin sync-log table — full stack traces stay in
-- Vercel logs.
--
-- ON DELETE SET NULL on triggered_by because deleting a profile shouldn't
-- silently nuke the audit trail; the sync still happened.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.sync_log (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  kind            sync_kind   not null,
  status          sync_status not null,
  photos_added    int not null default 0,
  photos_updated  int not null default 0,
  photos_removed  int not null default 0,
  error_summary   text,
  triggered_by    uuid references public.profiles(id) on delete set null
);

create index sync_log_started_at_idx
  on public.sync_log (started_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
--
-- smugmug_config follows the established read-by-everyone / write-by-admins
-- pattern shared with points_config, app_settings, tags, examples, and
-- senior_routing_rules. sync_log is admin-read-only — there's no
-- authenticated write policy because the cron + manual sync handlers run
-- under the service role, which bypasses RLS entirely (intentional; see
-- 8.4 for the auth-check-before-service-role pattern at the handler level).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.smugmug_config enable row level security;
alter table public.sync_log       enable row level security;

create policy smugmug_config_select_authenticated
  on public.smugmug_config for select to authenticated using (true);

create policy smugmug_config_write_admin
  on public.smugmug_config for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy sync_log_select_admin
  on public.sync_log for select to authenticated
  using (public.is_admin());
