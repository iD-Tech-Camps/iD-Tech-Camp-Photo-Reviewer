-- TRIAGE_SPEC §4 — trigger-level contract tests.
-- Run locally after migrations 27+28:
--   npx supabase db reset
--   npx supabase db query --file supabase/tests/e2e_triage_triggers.sql

begin;

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'eeeeeeee-1111-1111-1111-111111111101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-triage-senior@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  'eeeeeeee-1111-1111-1111-111111111102',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-triage-reviewer@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

update public.profiles set role = 'senior' where id = 'eeeeeeee-1111-1111-1111-111111111101';

insert into public.divisions (id, name, smugmug_folder_id) values
  ('eeeeeeee-2222-2222-2222-222222222201', 'E2E Triage Division', 'e2e-triage-div');

insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('eeeeeeee-2222-2222-2222-222222222202',
   'eeeeeeee-2222-2222-2222-222222222201',
   'E2E Triage Location', 'e2e-triage-loc');

do $$
declare
  v_loc uuid := 'eeeeeeee-2222-2222-2222-222222222202';
  v_week1 uuid;
  v_week2 uuid;
  v_role public.camp_week_triage_role;
  v_state public.camp_week_triage_state;
  v_photo_state public.photo_triage_state;
  v_count int;
  v_claim_id uuid;
begin
  -- ── 1. Role derivation ─────────────────────────────────────────────
  -- Use current-relative dates so week 1 is a *current* (not-yet-passed) week:
  -- a passed week with no photos is now treated as orphaned (migration 49) and
  -- would not hold first_week.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Week 1', 'e2e-triage-w1', current_date, current_date + 4)
  returning id into v_week1;

  select triage_role into v_role from public.camp_weeks where id = v_week1;
  if v_role <> 'first_week' then
    raise exception 'role derivation: expected first_week, got %', v_role;
  end if;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Week 2', 'e2e-triage-w2', current_date + 7, current_date + 11)
  returning id into v_week2;

  select triage_role into v_role from public.camp_weeks where id = v_week2;
  if v_role <> 'none' then
    raise exception 'role derivation: week2 should be none, got %', v_role;
  end if;

  update public.camp_weeks set is_first_week_override = true where id = v_week2;
  select triage_role into v_role from public.camp_weeks where id = v_week2;
  if v_role <> 'first_week' then
    raise exception 'override true: expected first_week, got %', v_role;
  end if;

  -- Set role first (compute trigger does not fire on triage_role alone).
  update public.camp_weeks set triage_role = 'second_week_recheck' where id = v_week2;
  update public.camp_weeks set is_first_week_override = null where id = v_week2;
  update public.camp_weeks set starts_on = current_date + 8 where id = v_week2;
  select triage_role into v_role from public.camp_weeks where id = v_week2;
  if v_role <> 'second_week_recheck' then
    raise exception 'second_week_recheck should be preserved, got %', v_role;
  end if;

  raise notice 'scenario 1 OK: role derivation';

  -- ── 2. Fanout none → first_week ──────────────────────────────────────
  update public.camp_weeks set triage_role = 'none', triage_state = 'not_required' where id = v_week1;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week1, 'e2e-triage-fanout-1');

  update public.camp_weeks set triage_role = 'first_week' where id = v_week1;

  select triage_state into v_state from public.camp_weeks where id = v_week1;
  if v_state <> 'photos_in' then
    raise exception 'fanout: expected photos_in, got %', v_state;
  end if;

  select triage_state into v_photo_state from public.photos where smugmug_image_id = 'e2e-triage-fanout-1';
  if v_photo_state <> 'pending' then
    raise exception 'fanout: photo should be pending, got %', v_photo_state;
  end if;

  raise notice 'scenario 2 OK: fanout';

  -- ── 3. Recompute → triage_done; late photo reopens ───────────────────
  update public.camp_weeks
  set triage_state = 'triage_in_progress', triage_role = 'first_week'
  where id = v_week1;

  update public.photos set triage_state = 'clean' where camp_week_id = v_week1;

  select triage_state into v_state from public.camp_weeks where id = v_week1;
  if v_state <> 'triage_done' then
    raise exception 'recompute: expected triage_done, got %', v_state;
  end if;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week1, 'e2e-triage-late');

  select triage_state into v_state from public.camp_weeks where id = v_week1;
  if v_state <> 'triage_in_progress' then
    raise exception 'late photo: expected triage_in_progress, got %', v_state;
  end if;

  raise notice 'scenario 3 OK: recompute';

  -- Scenario 4 (signoff side effect → second_week_recheck) intentionally
  -- removed after the location-approval refactor. The per-camp-week signoff
  -- flow no longer assigns 'complete' nor flips a sibling week to
  -- second_week_recheck. Approval-level contract tests live in
  -- supabase/tests/e2e_location_approval.sql.
end;
$$;

-- ── 5. Orphaned phantom first week → recompute promotes the real week ────────
-- Mirrors the production bug: an early week (folder for a week camp never ran)
-- held first_week with no photos, while the real later week sat at role 'none'
-- and never reached reviewers. recompute_all_triage_roles() (run at the end of
-- every sync) must demote the empty passed week and promote the one with photos.
insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('eeeeeeee-2222-2222-2222-222222222203',
   'eeeeeeee-2222-2222-2222-222222222201',
   'E2E Orphan Location', 'e2e-orphan-loc');

do $$
declare
  v_loc uuid := 'eeeeeeee-2222-2222-2222-222222222203';
  v_phantom uuid;
  v_real uuid;
  v_phantom_photo uuid;
  v_role public.camp_week_triage_role;
  v_photo_state public.photo_triage_state;
begin
  -- Phantom: earliest week, will end up empty. Seed it with a photo first so it
  -- legitimately starts as first_week and the real week starts as 'none'.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Phantom Week', 'e2e-orphan-phantom', current_date - 30, current_date - 26)
  returning id into v_phantom;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_phantom, 'e2e-orphan-phantom-photo')
  returning id into v_phantom_photo;

  -- Real week: later, has photos. With the phantom still holding photos it
  -- derives to 'none' (ordinal 2).
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Real Week', 'e2e-orphan-real', current_date - 3, current_date + 1)
  returning id into v_real;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_real, 'e2e-orphan-real-photo');

  select triage_role into v_role from public.camp_weeks where id = v_real;
  if v_role <> 'none' then
    raise exception 'orphan setup: real week should start none, got %', v_role;
  end if;

  -- The phantom folder is emptied on SmugMug → its photos are removed by the
  -- photo pass. Now it's passed + empty, but its role is still stale first_week.
  delete from public.photos where id = v_phantom_photo;

  -- End-of-sync recompute.
  perform public.recompute_all_triage_roles();

  select triage_role into v_role from public.camp_weeks where id = v_phantom;
  if v_role <> 'none' then
    raise exception 'orphan: phantom should be demoted to none, got %', v_role;
  end if;

  select triage_role into v_role from public.camp_weeks where id = v_real;
  if v_role <> 'first_week' then
    raise exception 'orphan: real week should be promoted to first_week, got %', v_role;
  end if;

  select triage_state into v_photo_state from public.photos where smugmug_image_id = 'e2e-orphan-real-photo';
  if v_photo_state <> 'pending' then
    raise exception 'orphan: promoted real-week photo should be pending, got %', v_photo_state;
  end if;

  raise notice 'scenario 5 OK: orphan phantom demoted, real week promoted';
end;
$$;

select 'e2e triage triggers passed' as result;

rollback;
