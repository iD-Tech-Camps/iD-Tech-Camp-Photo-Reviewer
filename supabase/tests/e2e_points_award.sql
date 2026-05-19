-- GAMIFICATION_SPEC §7 — points-award trigger contract tests.
-- Run locally after migration 32:
--   npx supabase db reset
--   npx supabase db query --file supabase/tests/e2e_points_award.sql

begin;

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'eeeeeeee-1111-1111-1111-111111111201',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-points-reviewer@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  'eeeeeeee-1111-1111-1111-111111111202',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-points-senior@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

update public.profiles set role = 'senior' where id = 'eeeeeeee-1111-1111-1111-111111111202';

insert into public.divisions (id, name, smugmug_folder_id) values
  ('eeeeeeee-2222-2222-2222-222222222301', 'E2E Points Division', 'e2e-points-div');

insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('eeeeeeee-2222-2222-2222-222222222302',
   'eeeeeeee-2222-2222-2222-222222222301',
   'E2E Points Location', 'e2e-points-loc');

do $$
declare
  v_loc uuid := 'eeeeeeee-2222-2222-2222-222222222302';
  v_reviewer uuid := 'eeeeeeee-1111-1111-1111-111111111201';
  v_senior uuid := 'eeeeeeee-1111-1111-1111-111111111202';
  v_week uuid;
  v_photo1 uuid; v_photo2 uuid; v_photo3 uuid; v_photo4 uuid; v_photo5 uuid;
  v_event uuid;
  v_count int;
  v_points int;
  v_user uuid;
  v_source uuid;
  v_occurred timestamptz;
  v_event_created timestamptz;
  v_first_event_points int;
begin
  -- Ensure rule starts at the seeded default for the test (idempotent).
  update public.points_rules set points = 1 where source_kind = 'triage_event';

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Week 1', 'e2e-points-w1', date '2026-06-01', date '2026-06-05')
  returning id into v_week;

  insert into public.photos (id, camp_week_id, smugmug_image_id)
  values (gen_random_uuid(), v_week, 'e2e-points-p1') returning id into v_photo1;
  insert into public.photos (id, camp_week_id, smugmug_image_id)
  values (gen_random_uuid(), v_week, 'e2e-points-p2') returning id into v_photo2;
  insert into public.photos (id, camp_week_id, smugmug_image_id)
  values (gen_random_uuid(), v_week, 'e2e-points-p3') returning id into v_photo3;
  insert into public.photos (id, camp_week_id, smugmug_image_id)
  values (gen_random_uuid(), v_week, 'e2e-points-p4') returning id into v_photo4;
  insert into public.photos (id, camp_week_id, smugmug_image_id)
  values (gen_random_uuid(), v_week, 'e2e-points-p5') returning id into v_photo5;

  -- ── 1. Clean event awards exactly one ledger row at the seeded value ──
  insert into public.triage_events (photo_id, reviewer_id, kind)
  values (v_photo1, v_reviewer, 'clean')
  returning id, created_at into v_event, v_event_created;

  select count(*) into v_count
    from public.points_ledger
   where source_kind = 'triage_event' and source_id = v_event;
  if v_count <> 1 then
    raise exception 'scenario 1: expected 1 ledger row for clean event, got %', v_count;
  end if;

  select user_id, points, occurred_at into v_user, v_points, v_occurred
    from public.points_ledger
   where source_kind = 'triage_event' and source_id = v_event;
  if v_user <> v_reviewer then
    raise exception 'scenario 1: ledger user_id should be reviewer (%), got %', v_reviewer, v_user;
  end if;
  if v_points <> 1 then
    raise exception 'scenario 1: expected 1 point, got %', v_points;
  end if;
  if v_occurred <> v_event_created then
    raise exception 'scenario 1: occurred_at should equal event.created_at (% vs %)', v_occurred, v_event_created;
  end if;
  v_first_event_points := v_points;

  raise notice 'scenario 1 OK: clean event awards seeded point';

  -- ── 2. Senior kinds don't award ──────────────────────────────────────
  insert into public.triage_events (photo_id, reviewer_id, kind)
  values (v_photo2, v_senior, 'senior_delete');

  select count(*) into v_count
    from public.points_ledger
   where user_id = v_senior;
  if v_count <> 0 then
    raise exception 'scenario 2: senior_delete should award nothing, got % rows for senior', v_count;
  end if;

  -- And the reviewer's total is unchanged.
  select count(*) into v_count
    from public.points_ledger
   where user_id = v_reviewer;
  if v_count <> 1 then
    raise exception 'scenario 2: reviewer ledger count should still be 1, got %', v_count;
  end if;

  raise notice 'scenario 2 OK: senior kinds ignored';

  -- ── 3. Rule update to 5 — new rows take new value, old row unchanged ─
  update public.points_rules set points = 5 where source_kind = 'triage_event';

  insert into public.triage_events (photo_id, reviewer_id, kind)
  values (v_photo3, v_reviewer, 'clean')
  returning id into v_event;

  select points into v_points
    from public.points_ledger
   where source_kind = 'triage_event' and source_id = v_event;
  if v_points <> 5 then
    raise exception 'scenario 3: new ledger row should have 5 points, got %', v_points;
  end if;

  -- Snapshot principle: scenario-1 ledger row stays at its original value.
  select points into v_points
    from public.points_ledger
   where source_kind = 'triage_event' and source_id in (
     select id from public.triage_events
      where photo_id = v_photo1 and kind = 'clean'
     limit 1
   );
  if v_points <> v_first_event_points then
    raise exception 'scenario 3: original ledger row should still be % points, got %', v_first_event_points, v_points;
  end if;

  raise notice 'scenario 3 OK: rule changes do not rewrite history';

  -- ── 4. Rule = 0 still inserts a ledger row (§0.6) ────────────────────
  update public.points_rules set points = 0 where source_kind = 'triage_event';

  insert into public.triage_events (photo_id, reviewer_id, kind)
  values (v_photo4, v_reviewer, 'clean')
  returning id into v_event;

  select count(*) into v_count
    from public.points_ledger
   where source_kind = 'triage_event' and source_id = v_event;
  if v_count <> 1 then
    raise exception 'scenario 4: rule=0 should still insert 1 ledger row, got %', v_count;
  end if;

  select points into v_points
    from public.points_ledger
   where source_kind = 'triage_event' and source_id = v_event;
  if v_points <> 0 then
    raise exception 'scenario 4: expected 0 points, got %', v_points;
  end if;

  raise notice 'scenario 4 OK: rule=0 still records activity';

  -- ── 5. flag also awards (parity with clean) ──────────────────────────
  update public.points_rules set points = 3 where source_kind = 'triage_event';

  insert into public.triage_events (photo_id, reviewer_id, kind)
  values (v_photo5, v_reviewer, 'flag')
  returning id into v_event;

  select points into v_points
    from public.points_ledger
   where source_kind = 'triage_event' and source_id = v_event;
  if v_points <> 3 then
    raise exception 'scenario 5: flag should award 3 points, got %', v_points;
  end if;

  raise notice 'scenario 5 OK: flag awards too';

  -- ── 6. user_points_totals view aggregates correctly ──────────────────
  select total_points into v_points
    from public.user_points_totals where user_id = v_reviewer;
  -- 1 (clean@1) + 5 (clean@5) + 0 (clean@0) + 3 (flag@3) = 9
  if v_points <> 9 then
    raise exception 'scenario 6: reviewer total should be 9, got %', v_points;
  end if;

  raise notice 'scenario 6 OK: user_points_totals aggregates';
end;
$$;

select 'e2e points award passed' as result;

rollback;
