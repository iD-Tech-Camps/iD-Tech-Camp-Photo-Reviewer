-- Step 5 smoke test — RUN BY HAND, NOT A MIGRATION.
--
-- This file is deliberately outside supabase/migrations/ so that
-- `supabase db push` and CI never apply it. Run it directly when you want to
-- verify that the schema's triggers and constraints behave correctly:
--
--     psql "$SUPABASE_DB_URL" -f supabase/tests/smoke_test.sql
--   or paste it into the Supabase dashboard's SQL editor.
--
-- The whole script runs inside a transaction with `rollback;` at the end, so
-- it leaves no rows behind. RLS is bypassed because it's intended to be run
-- as a superuser / service role connection.

begin;

-- Drop the profiles -> auth.users FK for the duration of this transaction
-- so we don't need to seed real auth.users rows. DDL is transactional in
-- Postgres, so the `rollback;` at the end restores the constraint.
-- (We deliberately do NOT use `session_replication_role = replica` here --
-- that disables every user-defined trigger too, including the four review
-- triggers we're trying to verify. See migration 02 for the constraint name.)
alter table public.profiles drop constraint profiles_id_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Seed a minimal hierarchy and one photo.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.divisions (id, name, smugmug_folder_id)
values ('11111111-1111-1111-1111-111111111111', 'Smoke Division', 'sm-div-1');

insert into public.locations (id, division_id, name, smugmug_folder_id)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Smoke Location',
  'sm-loc-1'
);

insert into public.camp_weeks (id, location_id, name, smugmug_folder_id, starts_on, ends_on)
values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'Smoke Week',
  'sm-week-1',
  current_date - 1,
  current_date + 5
);

insert into public.photos (id, camp_week_id, smugmug_image_id, caption)
values (
  '44444444-4444-4444-4444-444444444444',
  '33333333-3333-3333-3333-333333333333',
  'sm-img-1',
  'smoke test photo'
);

-- Two synthetic reviewers (skipping auth.users — service role only).
insert into public.profiles (id, email, full_name, role)
values
  ('55555555-5555-5555-5555-555555555555', 'reviewer@example.test', 'Smoke Reviewer', 'reviewer'),
  ('66666666-6666-6666-6666-666666666666', 'senior@example.test',   'Smoke Senior',   'senior');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Approve flow — current_status should flip to 'approved', is_quarantined
--    should remain false, points_awarded should be 10 (from points_config).
--
-- Note on the `and decision = '...'` filter in the points_awarded lookup:
-- inside a single transaction `now()` returns the transaction's start time,
-- so every reviews row inserted in this script shares the same created_at
-- value. `order by created_at desc limit 1` is therefore non-deterministic
-- once more than one review row exists. Filtering by decision picks exactly
-- the row each assertion is reasoning about, regardless of insert order.
-- Future additions to this test should follow the same pattern.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.reviews (photo_id, reviewer_id, decision, rating)
values (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  'approve',
  5
);

do $$
declare
  ph record;
  rv record;
begin
  select current_status, is_quarantined into ph
    from public.photos where id = '44444444-4444-4444-4444-444444444444';
  if ph.current_status <> 'approved' then
    raise exception 'expected approved, got %', ph.current_status;
  end if;
  if ph.is_quarantined <> false then
    raise exception 'expected is_quarantined=false, got %', ph.is_quarantined;
  end if;

  select points_awarded into rv from public.reviews
   where photo_id = '44444444-4444-4444-4444-444444444444'
     and decision = 'approve'
   order by created_at desc limit 1;
  if rv.points_awarded <> 10 then
    raise exception 'expected approve points=10, got %', rv.points_awarded;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Flag-with-quarantine flow — current_status='flagged', is_quarantined=true,
--    points_awarded=15.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.reviews (photo_id, reviewer_id, decision, quarantine, note)
values (
  '44444444-4444-4444-4444-444444444444',
  '55555555-5555-5555-5555-555555555555',
  'flag',
  true,
  'second-eyes please'
);

do $$
declare
  ph record;
  rv record;
begin
  select current_status, is_quarantined into ph
    from public.photos where id = '44444444-4444-4444-4444-444444444444';
  if ph.current_status <> 'flagged' then
    raise exception 'expected flagged, got %', ph.current_status;
  end if;
  if ph.is_quarantined <> true then
    raise exception 'expected is_quarantined=true, got %', ph.is_quarantined;
  end if;

  select points_awarded into rv from public.reviews
   where photo_id = '44444444-4444-4444-4444-444444444444'
     and decision = 'flag'
   order by created_at desc limit 1;
  if rv.points_awarded <> 15 then
    raise exception 'expected flag points=15, got %', rv.points_awarded;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Senior re-admits via approve — is_quarantined back to false.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.reviews (photo_id, reviewer_id, decision, rating)
values (
  '44444444-4444-4444-4444-444444444444',
  '66666666-6666-6666-6666-666666666666',
  'approve',
  4
);

do $$
declare ph record;
begin
  select current_status, is_quarantined into ph
    from public.photos where id = '44444444-4444-4444-4444-444444444444';
  if ph.current_status <> 'approved' or ph.is_quarantined <> false then
    raise exception 'expected approved + not quarantined, got % / %',
      ph.current_status, ph.is_quarantined;
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Constraint violations — each of these should raise.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  begin
    insert into public.reviews (photo_id, reviewer_id, decision, rating)
    values (
      '44444444-4444-4444-4444-444444444444',
      '55555555-5555-5555-5555-555555555555',
      'flag',
      3
    );
    raise exception 'expected check violation: rating on flag';
  exception when check_violation then null;
  end;

  begin
    insert into public.reviews (photo_id, reviewer_id, decision, quarantine)
    values (
      '44444444-4444-4444-4444-444444444444',
      '55555555-5555-5555-5555-555555555555',
      'approve',
      true
    );
    raise exception 'expected check violation: quarantine on approve';
  exception when check_violation then null;
  end;
end$$;

-- All assertions passed if we reached this point.
select 'smoke test passed' as result;

rollback;
