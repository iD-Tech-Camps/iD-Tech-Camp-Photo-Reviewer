-- Step 7.6d — Bonus periods on the DB
--
-- The "Points Multiplier Bonus" schedule lived in localStorage on each
-- admin's browser, which meant reviewers never actually saw it unless the
-- admin happened to be the same person on the same machine. This migration
-- gives it a proper table so admins schedule once and every reviewer sees
-- the active pennant.
--
-- Two modes of schedule:
--   - 'recurring'  → days[] (0-6, Sun-Sat) + start_time / end_time as
--                    HH:MM strings, evaluated in the reviewer's local
--                    browser timezone. Same model the TS BonusPeriod has
--                    been using since the multiplier UI shipped.
--   - 'one-time'   → start_at / end_at as timestamptz; evaluated against
--                    the wall clock at read time. Stored as timestamptz
--                    so DST and timezone changes don't shift the window.
--
-- Per-row columns track exactly one mode at a time. The unused columns
-- are always populated (with safe fallbacks) so app code doesn't have
-- to null-check based on mode — the row's `mode` discriminates which
-- columns to read.
--
-- Trigger-side: the existing reviews_snapshot_points trigger keeps its
-- "fall back to points_config when caller didn't supply points_awarded"
-- behavior. The client now passes points_awarded explicitly with the
-- bonus multiplier already applied, so the snapshot correctly reflects
-- whatever bonus was active at decision time. This closes the gap the
-- spec called out under "Bonus-period multiplier is UI-only" — without
-- needing the trigger itself to read bonus_periods (which would require
-- timezone-aware logic Postgres doesn't have a clean answer for).

create type bonus_period_mode as enum ('recurring', 'one-time');

create table public.bonus_periods (
  id           uuid primary key default gen_random_uuid(),
  label        text not null default '',
  mode         bonus_period_mode not null,

  -- Recurring schedule: days[0..6] (Sun=0) + HH:MM clock window.
  days         smallint[] not null default '{}',
  start_time   text       not null default '00:00',
  end_time     text       not null default '00:00',

  -- One-time schedule: an explicit timestamptz range. Nullable because
  -- recurring rows don't have a meaningful single instant; the check
  -- constraint below enforces non-null when mode = 'one-time'.
  start_at     timestamptz,
  end_at       timestamptz,

  multiplier   numeric(4, 2) not null,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Multiplier is bounded to match the admin UI's slider. 1× would be a
  -- no-op (no point in scheduling), 10× is the deliberate cap to keep
  -- weekly point totals interpretable.
  constraint bonus_periods_multiplier_range
    check (multiplier between 1.10 and 10.00),

  -- HH:MM format guard. App layer also validates, but a tight check here
  -- catches typos in direct SQL edits.
  constraint bonus_periods_start_time_format
    check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint bonus_periods_end_time_format
    check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  -- Days[] elements must each be a valid weekday (0-6). Unnest into a
  -- sub-select to keep this readable.
  constraint bonus_periods_days_valid
    check (
      days <@ array[0,1,2,3,4,5,6]::smallint[]
    ),

  -- Mode-specific completeness. Recurring needs at least one day and a
  -- non-trivial clock window; one-time needs both timestamps and a
  -- non-trivial range.
  constraint bonus_periods_recurring_complete
    check (
      mode <> 'recurring' or (
        cardinality(days) > 0
        and start_time <> end_time
      )
    ),
  constraint bonus_periods_onetime_complete
    check (
      mode <> 'one-time' or (
        start_at is not null
        and end_at is not null
        and end_at > start_at
      )
    )
);

-- Lookup pattern: most reads filter by enabled = true and order by
-- multiplier desc (the "best active bonus" picker). Index covers that.
create index bonus_periods_enabled_multiplier_idx
  on public.bonus_periods (enabled, multiplier desc);

-- Touch updated_at on every UPDATE so consumers can cache-invalidate.
create or replace function public.bonus_periods_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tg_bonus_periods_touch_updated_at
  before update on public.bonus_periods
  for each row execute function public.bonus_periods_touch_updated_at();

-- RLS: same pattern as the other config tables (tags, examples,
-- points_config, app_settings). Anyone can read; only admins can write.
alter table public.bonus_periods enable row level security;

create policy bonus_periods_select_authenticated
  on public.bonus_periods for select to authenticated using (true);

create policy bonus_periods_write_admin
  on public.bonus_periods for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
