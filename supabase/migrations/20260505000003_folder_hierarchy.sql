-- Step 5.3 — Folder hierarchy
-- Mirrors the SmugMug node tree: division → location → camp_week. All three
-- carry the SmugMug folder id so the import job can dedupe and reconcile.
-- Cascading deletes are intentional: if a division goes away, everything
-- under it does too. Photos hang off camp_weeks but use ON DELETE RESTRICT
-- (defined in the photos migration) to avoid accidental data loss.

create table public.divisions (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  smugmug_folder_id  text not null unique,
  created_at         timestamptz not null default now()
);

create table public.locations (
  id                 uuid primary key default gen_random_uuid(),
  division_id        uuid not null references public.divisions(id) on delete cascade,
  name               text not null,
  smugmug_folder_id  text not null unique,
  created_at         timestamptz not null default now()
);

create table public.camp_weeks (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations(id) on delete cascade,
  name               text not null,
  smugmug_folder_id  text not null unique,
  starts_on          date not null,
  ends_on            date not null,
  created_at         timestamptz not null default now()
);

create index camp_weeks_dates_idx on public.camp_weeks (starts_on, ends_on);

-- "Is this week currently active?" is conceptually a column on camp_weeks,
-- but Postgres requires stored generated columns to use IMMUTABLE expressions
-- and `current_date` is only STABLE (it shifts with the session's
-- transaction timestamp). To preserve the spec's intent, expose is_active as
-- a derived field through this view; app code can read camp_weeks_with_status
-- whenever it wants the boolean, while writes still go straight to camp_weeks.
create view public.camp_weeks_with_status as
  select *, (current_date between starts_on and ends_on) as is_active
    from public.camp_weeks;
