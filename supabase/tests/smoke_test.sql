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

-- Skip FK and trigger enforcement for this transaction so we don't have to
-- create real auth.users rows just to satisfy profiles.id -> auth.users(id).
-- The rollback at the end of the script restores normal behavior; this
-- setting is also transaction-local thanks to `set local`.
set local session_replication_role = replica;

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
