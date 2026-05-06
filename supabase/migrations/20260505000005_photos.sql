-- Step 5.5 — Photos
-- One row per SmugMug image. current_status and is_quarantined are denormalized
-- from the latest review for fast queue queries; both are maintained by
-- triggers attached in migration 06. For now they default to 'pending' / false
-- so a few rows can be hand-seeded and queried before reviews exist.
--
-- ON DELETE RESTRICT on the camp_week fk is intentional: removing a week
-- shouldn't silently nuke the photos and their review history. Photos must
-- be moved or explicitly deleted first.

create table public.photos (
  id                 uuid primary key default gen_random_uuid(),
  camp_week_id       uuid not null references public.camp_weeks(id) on delete restrict,
  smugmug_image_id   text not null unique,
  smugmug_url        text,
  image_url          text,
  thumbnail_url      text,
  caption            text,
  captured_at        timestamptz,
  width              int,
  height             int,
  current_status     photo_status not null default 'pending',
  is_quarantined     boolean not null default false,
  smugmug_folder_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index photos_queue_idx
  on public.photos (current_status, camp_week_id);

create index photos_quarantined_idx
  on public.photos (is_quarantined)
  where is_quarantined = true;
