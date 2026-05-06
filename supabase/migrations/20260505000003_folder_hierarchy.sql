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
  -- Stored generated column so the queue can sort by it without recomputing.
  is_active          boolean generated always as (current_date between starts_on and ends_on) stored,
  created_at         timestamptz not null default now()
);

create index camp_weeks_active_recent_idx
  on public.camp_weeks (is_active, starts_on desc);
