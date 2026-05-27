-- Step 8.8 / TRIAGE_SPEC §8 — server-side check for the SmugMug sync
-- engine's *database* contract.
--
-- Five scenarios (post migration 27):
--   1. Clean-slate sync inserts the expected rows.
--   2. A re-run is a no-op (same images, no drift → no UPDATE).
--   3. Orphan photos are deleted only when triage_state = not_required
--      and no triage_events row exists (mirrors photos.ts orphan guard).
--   4. Re-parenting: same smugmug_image_id moves camp_week_id.
--   5. Triage preservation: orphans with triage_events or non-default
--      triage_state are not deleted.
--
-- Run locally (NOT --linked):
--   npx supabase db reset
--   npx supabase db query --file supabase/tests/e2e_smugmug_sync_flow.sql

begin;

insert into public.divisions (id, name, smugmug_folder_id) values
  ('dddddddd-4444-4444-4444-444444444441', 'E2E Sync Test Division', 'e2e-sync-div');
insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('dddddddd-4444-4444-4444-444444444442',
   'dddddddd-4444-4444-4444-444444444441',
   'E2E Sync Test Location',
   'e2e-sync-loc');
insert into public.camp_weeks (id, location_id, name, smugmug_folder_id, starts_on, ends_on) values
  ('dddddddd-4444-4444-4444-444444444443',
   'dddddddd-4444-4444-4444-444444444442',
   'E2E Sync Test Week A',
   'e2e-sync-week-a',
   current_date - 7,
   current_date - 1),
  ('dddddddd-4444-4444-4444-444444444444',
   'dddddddd-4444-4444-4444-444444444442',
   'E2E Sync Test Week B',
   'e2e-sync-week-b',
   current_date,
   current_date + 6);

-- Fixture user + profile for triage_events FK.
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'dddddddd-4444-4444-4444-444444444445',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-sync@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

do $$
declare
  v_week_a uuid := 'dddddddd-4444-4444-4444-444444444443';
  v_week_b uuid := 'dddddddd-4444-4444-4444-444444444444';
  v_reviewer uuid := 'dddddddd-4444-4444-4444-444444444445';
  v_count int;
  v_caption text;
  v_camp_week uuid;
  v_photo_id uuid;
  v_orphan_id uuid;
begin
  -- ── 1. Clean-slate inserts ─────────────────────────────────────────
  insert into public.photos (camp_week_id, smugmug_image_id, caption, captured_at, width, height) values
    (v_week_a, 'e2e-sync-img-1', 'Workshop', timestamptz '2026-05-26 10:00:00-04', 1600, 1067),
    (v_week_a, 'e2e-sync-img-2', 'Lunch',    timestamptz '2026-05-26 12:00:00-04', 1600, 1067),
    (v_week_a, 'e2e-sync-img-3', 'Demo',     timestamptz '2026-05-26 15:00:00-04', 1600, 1067);

  select count(*) into v_count from public.photos where camp_week_id = v_week_a;
  if v_count <> 3 then
    raise exception 'scenario 1: expected 3 photos under week A, got %', v_count;
  end if;

  select caption into v_caption from public.photos where smugmug_image_id = 'e2e-sync-img-1';
  if v_caption <> 'Workshop' then
    raise exception 'scenario 1: caption did not persist (got %)', v_caption;
  end if;

  raise notice 'scenario 1 OK';

  -- ── 2. Re-run is a no-op ───────────────────────────────────────────
  declare
    v_updated_before timestamptz;
    v_updated_after  timestamptz;
  begin
    select updated_at into v_updated_before
    from public.photos where smugmug_image_id = 'e2e-sync-img-1';

    update public.photos set
      caption     = 'Workshop',
      captured_at = timestamptz '2026-05-26 10:00:00-04',
      width       = 1600,
      height      = 1067
    where smugmug_image_id = 'e2e-sync-img-1'
      and (caption <> 'Workshop'
           or captured_at <> timestamptz '2026-05-26 10:00:00-04'
           or width <> 1600
           or height <> 1067);

    select updated_at into v_updated_after
    from public.photos where smugmug_image_id = 'e2e-sync-img-1';
    if v_updated_after <> v_updated_before then
      raise exception 'scenario 2: re-run was not a no-op';
    end if;
  end;

  begin
    insert into public.photos (camp_week_id, smugmug_image_id) values (v_week_a, 'e2e-sync-img-1');
    raise exception 'scenario 2: duplicate INSERT should have raised unique_violation';
  exception when unique_violation then
    null;
  end;

  raise notice 'scenario 2 OK';

  -- ── 3. Orphan delete with triage preservation filter ─────────────
  -- Mirrors fetchProtectedOrphanIds + delete in lib/smugmug/sync/photos.ts.
  -- The BEFORE-INSERT trigger on public.photos forces triage_state='pending'
  -- when the camp_week's triage_role is first_week/second_week_recheck, which
  -- the test weeks above satisfy. The orphan-delete filter we're exercising
  -- only fires on photos that *are* in the not_required state, so put them
  -- there explicitly before testing the filter.
  update public.photos
     set triage_state = 'not_required'
   where camp_week_id = v_week_a
     and smugmug_image_id in ('e2e-sync-img-2', 'e2e-sync-img-3');

  with orphans as (
    select id, triage_state from public.photos
    where camp_week_id = v_week_a
      and smugmug_image_id in ('e2e-sync-img-2', 'e2e-sync-img-3')
  ),
  deletable as (
    select o.id from orphans o
    where o.triage_state = 'not_required'
      and not exists (
        select 1 from public.triage_events e where e.photo_id = o.id
      )
  )
  delete from public.photos where id in (select id from deletable);

  select count(*) into v_count
  from public.photos
  where smugmug_image_id in ('e2e-sync-img-2', 'e2e-sync-img-3');
  if v_count <> 0 then
    raise exception 'scenario 3: unprotected orphans should be deleted, % remain', v_count;
  end if;

  select count(*) into v_count from public.photos where smugmug_image_id = 'e2e-sync-img-1';
  if v_count <> 1 then
    raise exception 'scenario 3: img-1 was unexpectedly removed';
  end if;

  raise notice 'scenario 3 OK';

  -- ── 4. Re-parenting ────────────────────────────────────────────────
  insert into public.photos (camp_week_id, smugmug_image_id, captured_at)
  values (v_week_a, 'e2e-sync-img-reparent', timestamptz '2026-05-27 10:00:00-04')
  returning id into v_photo_id;

  update public.photos
  set camp_week_id = v_week_b
  where smugmug_image_id = 'e2e-sync-img-reparent'
    and camp_week_id <> v_week_b;

  select camp_week_id into v_camp_week from public.photos where id = v_photo_id;
  if v_camp_week <> v_week_b then
    raise exception 'scenario 4: re-parent did not move row to week B';
  end if;

  select count(*) into v_count from public.photos where smugmug_image_id = 'e2e-sync-img-reparent';
  if v_count <> 1 then
    raise exception 'scenario 4: expected exactly 1 row for reparented key, got %', v_count;
  end if;

  raise notice 'scenario 4 OK';

  -- ── 5. Triage preservation ─────────────────────────────────────────
  -- 5a: orphan with triage_events must survive filtered delete.
  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week_a, 'e2e-sync-img-preserve-event')
  returning id into v_orphan_id;

  insert into public.triage_events (photo_id, reviewer_id, kind)
  values (v_orphan_id, v_reviewer, 'clean');

  with orphans as (
    select id, triage_state from public.photos where id = v_orphan_id
  ),
  deletable as (
    select o.id from orphans o
    where o.triage_state = 'not_required'
      and not exists (select 1 from public.triage_events e where e.photo_id = o.id)
  )
  delete from public.photos where id in (select id from deletable);

  select count(*) into v_count from public.photos where id = v_orphan_id;
  if v_count <> 1 then
    raise exception 'scenario 5a: photo with triage_events should be preserved';
  end if;

  -- 5b: orphan with triage_state <> not_required must survive.
  insert into public.photos (camp_week_id, smugmug_image_id, triage_state)
  values (v_week_a, 'e2e-sync-img-preserve-state', 'pending')
  returning id into v_orphan_id;

  with orphans as (
    select id, triage_state from public.photos where id = v_orphan_id
  ),
  deletable as (
    select o.id from orphans o
    where o.triage_state = 'not_required'
      and not exists (select 1 from public.triage_events e where e.photo_id = o.id)
  )
  delete from public.photos where id in (select id from deletable);

  select count(*) into v_count from public.photos where id = v_orphan_id;
  if v_count <> 1 then
    raise exception 'scenario 5b: photo with triage_state pending should be preserved';
  end if;

  raise notice 'scenario 5 OK';
end;
$$;

select 'e2e smugmug sync flow passed' as result;

rollback;
