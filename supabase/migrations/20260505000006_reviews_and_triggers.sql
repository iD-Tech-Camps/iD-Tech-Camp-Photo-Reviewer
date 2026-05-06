-- Step 5.6 — Reviews, review_tags, and the four triggers
-- The reviews table is the immutable decision log. There is no UPDATE/DELETE
-- path: corrections are recorded as a new review row. photos.current_status
-- and photos.is_quarantined are derived from the latest review via triggers,
-- so reads stay simple at the cost of a write-side fan-out.

create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  photo_id        uuid not null references public.photos(id) on delete cascade,
  reviewer_id     uuid not null references public.profiles(id) on delete restrict,
  decision        decision not null,
  rating          smallint,
  note            text,
  quarantine      boolean not null default false,
  points_awarded  int not null default 0,
  created_at      timestamptz not null default now(),

  constraint reviews_rating_only_on_approve
    check (decision = 'approve' or rating is null),
  constraint reviews_rating_range
    check (rating is null or rating between 1 and 5),
  constraint reviews_quarantine_only_on_flag
    check (decision = 'flag' or quarantine = false)
);

create index reviews_photo_recent_idx
  on public.reviews (photo_id, created_at desc);

create index reviews_reviewer_recent_idx
  on public.reviews (reviewer_id, created_at desc);

create table public.review_tags (
  review_id  uuid not null references public.reviews(id) on delete cascade,
  tag_id     text not null references public.tags(id) on delete restrict,
  primary key (review_id, tag_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 1: snapshot points_awarded
-- BEFORE INSERT so the row written to disk already has the correct value.
-- Only fires when the caller didn't supply one (default 0). The app should
-- still pass it explicitly; this is defense in depth.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reviews_snapshot_points()
returns trigger
language plpgsql
as $$
declare
  cfg record;
begin
  if new.points_awarded is null or new.points_awarded = 0 then
    select approve_points, flag_points, delete_points
      into cfg
      from public.points_config
      where id = 1;

    if cfg is not null then
      new.points_awarded := case new.decision
        when 'approve' then cfg.approve_points
        when 'flag'    then cfg.flag_points
        when 'delete'  then cfg.delete_points
      end;
    end if;
  end if;
  return new;
end;
$$;

create trigger tg_reviews_snapshot_points
  before insert on public.reviews
  for each row execute function public.reviews_snapshot_points();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 2: maintain photos.current_status
-- approve → 'approved', flag → 'flagged', delete → 'deleted'.
-- Also bumps photos.updated_at so clients can cache-invalidate.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reviews_update_photo_status()
returns trigger
language plpgsql
as $$
begin
  update public.photos
     set current_status = case new.decision
                            when 'approve' then 'approved'::photo_status
                            when 'flag'    then 'flagged'::photo_status
                            when 'delete'  then 'deleted'::photo_status
                          end,
         updated_at = now()
   where id = new.photo_id;
  return new;
end;
$$;

create trigger tg_reviews_update_photo_status
  after insert on public.reviews
  for each row execute function public.reviews_update_photo_status();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 3: maintain photos.is_quarantined
--   flag + quarantine=true   → set true
--   approve | delete         → set false (re-admit / remove from quarantine)
--   flag + quarantine=false  → leave unchanged (a non-quarantining flag is
--                              just a heads-up; visibility shouldn't change)
-- The actual SmugMug folder move is the application's responsibility,
-- triggered by observing this column flip.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reviews_update_quarantine()
returns trigger
language plpgsql
as $$
begin
  if new.decision = 'flag' and new.quarantine = true then
    update public.photos set is_quarantined = true  where id = new.photo_id;
  elsif new.decision in ('approve', 'delete') then
    update public.photos set is_quarantined = false where id = new.photo_id;
  end if;
  return new;
end;
$$;

create trigger tg_reviews_update_quarantine
  after insert on public.reviews
  for each row execute function public.reviews_update_quarantine();

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger 4: bump profiles.last_active_at
-- Lightweight update that drives the "active in the last X minutes" pill in
-- the admin user list and the reviewer status enum transitions.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reviews_bump_last_active()
returns trigger
language plpgsql
as $$
begin
  update public.profiles
     set last_active_at = now()
   where id = new.reviewer_id;
  return new;
end;
$$;

create trigger tg_reviews_bump_last_active
  after insert on public.reviews
  for each row execute function public.reviews_bump_last_active();
