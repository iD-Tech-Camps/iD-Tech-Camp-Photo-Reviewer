-- Upload-alert generation + dismissal — contract tests.
-- Run locally after migrations:
--   npx supabase db reset
--   npx supabase db query --file supabase/tests/e2e_upload_alerts.sql
--
-- Weeks are created relative to current_date so the "currently-active week"
-- detection works regardless of when the suite runs (the feature is purely
-- date-range based and does not depend on the configured season window).
--
-- Scenarios:
--   1. Circuit breaker: with no location holding current-week photos, generate
--      creates nothing.
--   2. Happy path: once a peer has current-week photos, a location that was
--      active last week but is empty this week gets exactly one alert.
--   3. Suppressions: last-week-of-camp (no current week), cold-start (no prior
--      week), and a currently-uploading location are all left unflagged.
--   4. Dedupe: re-running generate creates no duplicate.
--   5. Dismiss: senior dismissal stamps dismissed_at/by; re-dismiss raises P0002.

begin;

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'bbbbbbbb-1111-1111-1111-111111111101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-alert-senior@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

update public.profiles set role = 'senior' where id = 'bbbbbbbb-1111-1111-1111-111111111101';

insert into public.divisions (id, name, smugmug_folder_id) values
  ('bbbbbbbb-2222-2222-2222-222222222201', 'E2E Alert Division', 'e2e-alert-div');

insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('bbbbbbbb-3333-3333-3333-333333333301', 'bbbbbbbb-2222-2222-2222-222222222201', 'E2E Alert Loc A', 'e2e-alert-a'),
  ('bbbbbbbb-3333-3333-3333-333333333302', 'bbbbbbbb-2222-2222-2222-222222222201', 'E2E Alert Loc B', 'e2e-alert-b'),
  ('bbbbbbbb-3333-3333-3333-333333333303', 'bbbbbbbb-2222-2222-2222-222222222201', 'E2E Alert Loc C', 'e2e-alert-c'),
  ('bbbbbbbb-3333-3333-3333-333333333304', 'bbbbbbbb-2222-2222-2222-222222222201', 'E2E Alert Loc D', 'e2e-alert-d');

do $$
declare
  v_senior uuid := 'bbbbbbbb-1111-1111-1111-111111111101';
  v_loc_a uuid := 'bbbbbbbb-3333-3333-3333-333333333301';  -- prev photos, empty current  → FLAG
  v_loc_b uuid := 'bbbbbbbb-3333-3333-3333-333333333302';  -- current photos, no prev     → peer, no flag
  v_loc_c uuid := 'bbbbbbbb-3333-3333-3333-333333333303';  -- prev photos, no current wk  → last week of camp, no flag
  v_loc_d uuid := 'bbbbbbbb-3333-3333-3333-333333333304';  -- empty current, no prev      → cold start, no flag
  v_prev_start date := current_date - 9;
  v_prev_end   date := current_date - 5;
  v_cur_start  date := current_date - 1;
  v_cur_end    date := current_date + 3;
  v_a_prev uuid; v_a_cur uuid;
  v_b_cur uuid;
  v_c_prev uuid;
  v_d_cur uuid;
  v_count int;
  v_alert_id uuid;
  v_dismissed timestamptz;
begin
  -- Location A: previous week (with a photo) + current week (empty).
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
    values (v_loc_a, 'A prev', 'e2e-a-prev', v_prev_start, v_prev_end) returning id into v_a_prev;
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
    values (v_loc_a, 'A current', 'e2e-a-cur', v_cur_start, v_cur_end) returning id into v_a_cur;
  insert into public.photos (camp_week_id, smugmug_image_id) values (v_a_prev, 'e2e-a-prev-p1');

  -- Location B: current week only (photos added later, in scenario 2).
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
    values (v_loc_b, 'B current', 'e2e-b-cur', v_cur_start, v_cur_end) returning id into v_b_cur;

  -- Location C: previous week only (season ended) — no current week.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
    values (v_loc_c, 'C prev', 'e2e-c-prev', v_prev_start, v_prev_end) returning id into v_c_prev;
  insert into public.photos (camp_week_id, smugmug_image_id) values (v_c_prev, 'e2e-c-prev-p1');

  -- Location D: current week only, empty — never uploaded a prior week.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
    values (v_loc_d, 'D current', 'e2e-d-cur', v_cur_start, v_cur_end) returning id into v_d_cur;

  -- ── Scenario 1: circuit breaker (no peer has current-week photos) ─────────
  perform 1 from public.generate_upload_alerts();
  select count(*) into v_count from public.upload_alerts;
  if v_count <> 0 then
    raise exception 'scenario 1: circuit breaker should suppress all alerts, got % rows', v_count;
  end if;
  raise notice 'scenario 1 OK: circuit breaker suppresses when no peer uploaded';

  -- ── Scenario 2: peer uploads → A is flagged, others are not ───────────────
  insert into public.photos (camp_week_id, smugmug_image_id) values (v_b_cur, 'e2e-b-cur-p1');

  perform 1 from public.generate_upload_alerts();

  select count(*) into v_count from public.upload_alerts;
  if v_count <> 1 then
    raise exception 'scenario 2: expected exactly 1 alert, got %', v_count;
  end if;

  if not exists (select 1 from public.upload_alerts where location_id = v_loc_a) then
    raise exception 'scenario 2: location A (active last week, empty this week) should be flagged';
  end if;

  -- Snapshot fields captured correctly.
  select id into v_alert_id from public.upload_alerts where location_id = v_loc_a;
  if (select location_name from public.upload_alerts where id = v_alert_id) <> 'E2E Alert Loc A'
     or (select division_name from public.upload_alerts where id = v_alert_id) <> 'E2E Alert Division'
     or (select week_start from public.upload_alerts where id = v_alert_id) <> v_cur_start
     or (select camp_week_id from public.upload_alerts where id = v_alert_id) <> v_a_cur then
    raise exception 'scenario 2: alert snapshot fields do not match location A current week';
  end if;

  raise notice 'scenario 2 OK: active location that went silent is flagged';

  -- ── Scenario 3: suppressions (B peer, C last-week, D cold-start) ──────────
  if exists (select 1 from public.upload_alerts where location_id = v_loc_b) then
    raise exception 'scenario 3: location B is currently uploading — should not be flagged';
  end if;
  if exists (select 1 from public.upload_alerts where location_id = v_loc_c) then
    raise exception 'scenario 3: location C has no current week (camp ended) — should not be flagged';
  end if;
  if exists (select 1 from public.upload_alerts where location_id = v_loc_d) then
    raise exception 'scenario 3: location D never uploaded a prior week — should not be flagged';
  end if;
  raise notice 'scenario 3 OK: peer / last-week / cold-start all suppressed';

  -- ── Scenario 4: dedupe — re-running creates nothing new ───────────────────
  perform 1 from public.generate_upload_alerts();
  select count(*) into v_count from public.upload_alerts;
  if v_count <> 1 then
    raise exception 'scenario 4: re-run should not duplicate, got % rows', v_count;
  end if;
  raise notice 'scenario 4 OK: re-run is idempotent (no re-alert)';

  -- ── Scenario 5: dismiss (senior) then re-dismiss raises P0002 ─────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_senior)::text, true);

  perform public.dismiss_upload_alert(v_alert_id);
  select dismissed_at into v_dismissed from public.upload_alerts where id = v_alert_id;
  if v_dismissed is null then
    raise exception 'scenario 5: dismiss should stamp dismissed_at';
  end if;
  if (select dismissed_by from public.upload_alerts where id = v_alert_id) <> v_senior then
    raise exception 'scenario 5: dismiss should stamp dismissed_by = caller';
  end if;

  begin
    perform public.dismiss_upload_alert(v_alert_id);
    raise exception 'scenario 5: re-dismiss should have raised';
  exception
    when sqlstate 'P0002' then
      raise notice 'scenario 5 OK: dismiss stamps record; re-dismiss rejected (P0002)';
  end;

  perform set_config('request.jwt.claims', '', true);
end;
$$;

select 'e2e upload alerts passed' as result;

rollback;
