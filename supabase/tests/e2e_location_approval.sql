-- LOCATION_APPROVAL_SPEC §9a — trigger-level contract tests.
-- Run locally after migrations 41-43:
--   npx supabase db reset
--   docker exec -i supabase_db_iD_Tech_Camp_Photo_Reviewer psql -U postgres -d postgres \
--     < supabase/tests/e2e_location_approval.sql
--
-- Scenarios:
--   1. Approve drain (pending+in_progress → not_required, active claim released
--      with reason 'location_approved', clean/flagged untouched).
--   2. Approve short-circuit on new photo (lands not_required).
--   3. Revoke reopen (drained photos → pending; released claims stay released).
--   4. Revoke + late photo (new photo at revoked location lands pending).
--   5. Concurrent approve (second active row 23505).
--   6. Re-approve after revoke (history retained, active row is the new one).

begin;

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'aaaaaaaa-1111-1111-1111-111111111101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-loc-senior@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  'aaaaaaaa-1111-1111-1111-111111111102',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-loc-reviewer@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

update public.profiles set role = 'senior' where id = 'aaaaaaaa-1111-1111-1111-111111111101';

insert into public.divisions (id, name, smugmug_folder_id) values
  ('aaaaaaaa-2222-2222-2222-222222222201', 'E2E Loc Division', 'e2e-loc-div');

insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('aaaaaaaa-2222-2222-2222-222222222202',
   'aaaaaaaa-2222-2222-2222-222222222201',
   'E2E Loc Location', 'e2e-loc-loc');

do $$
declare
  v_senior uuid := 'aaaaaaaa-1111-1111-1111-111111111101';
  v_reviewer uuid := 'aaaaaaaa-1111-1111-1111-111111111102';
  v_loc uuid := 'aaaaaaaa-2222-2222-2222-222222222202';
  v_week uuid;
  v_photo_pending uuid;
  v_photo_in_progress uuid;
  v_photo_clean uuid;
  v_photo_flagged uuid;
  v_photo_late uuid;
  v_claim_active uuid;
  v_approval_a uuid;
  v_approval_b uuid;
  v_state public.photo_triage_state;
  v_week_state public.camp_week_triage_state;
  v_released_at timestamptz;
  v_release_reason public.claim_release_reason;
  v_status text;
  v_count int;
begin
  -- Create a 1st-week camp_week within the configured season window.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'E2E Loc Week 1', 'e2e-loc-w1', date '2026-06-01', date '2026-06-05')
  returning id into v_week;

  -- ── Scenario 1: Approve drain ────────────────────────────────────────────

  -- Seed 4 photos: 1 pending, 1 in_progress (via claim), 1 clean, 1 flagged.
  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-loc-p1') returning id into v_photo_pending;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-loc-p2') returning id into v_photo_in_progress;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-loc-p3') returning id into v_photo_clean;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-loc-p4') returning id into v_photo_flagged;

  -- Claim 1 photo to put v_photo_in_progress into 'in_progress'.
  -- The claims trigger orders by captured_at asc — all photos have NULL
  -- captured_at so it orders by id asc; we don't care which specific photo
  -- ends up in_progress, just that one does.
  insert into public.triage_claims (camp_week_id, reviewer_id, slice_size)
  values (v_week, v_reviewer, 1)
  returning id into v_claim_active;

  -- Find which photo actually got stamped in_progress and overwrite our handle
  -- so the rest of the test stays meaningful.
  select id into v_photo_in_progress
    from public.photos
   where camp_week_id = v_week
     and triage_state = 'in_progress'
   limit 1;

  -- Manually set the remaining two photos to clean/flagged via triage_events
  -- (the events trigger handles the state transitions).
  -- Find a photo that's currently pending and isn't the in-progress one.
  select id into v_photo_clean
    from public.photos
   where camp_week_id = v_week
     and triage_state = 'pending'
     and id <> v_photo_in_progress
   limit 1;

  insert into public.triage_events (photo_id, reviewer_id, kind, claim_id)
  values (v_photo_clean, v_reviewer, 'clean', null);

  select id into v_photo_flagged
    from public.photos
   where camp_week_id = v_week
     and triage_state = 'pending'
     and id <> v_photo_in_progress
   limit 1;

  -- Need a tag to flag with — use any seeded tag.
  insert into public.triage_events (photo_id, reviewer_id, kind, claim_id, quarantine_intent)
  values (v_photo_flagged, v_reviewer, 'flag', null, false);

  -- The remaining pending photo
  select id into v_photo_pending
    from public.photos
   where camp_week_id = v_week
     and triage_state = 'pending'
   limit 1;

  -- Sanity check before approve.
  if (select count(*) from public.photos where camp_week_id = v_week and triage_state = 'pending') <> 1 then
    raise exception 'scenario 1 setup: expected 1 pending photo';
  end if;
  if (select count(*) from public.photos where camp_week_id = v_week and triage_state = 'in_progress') <> 1 then
    raise exception 'scenario 1 setup: expected 1 in_progress photo';
  end if;
  if (select count(*) from public.photos where camp_week_id = v_week and triage_state = 'clean') <> 1 then
    raise exception 'scenario 1 setup: expected 1 clean photo';
  end if;
  if (select count(*) from public.photos where camp_week_id = v_week and triage_state = 'flagged') <> 1 then
    raise exception 'scenario 1 setup: expected 1 flagged photo';
  end if;

  -- Approve.
  insert into public.location_approvals (location_id, season_start, approved_by)
  values (v_loc, (select season_first_week_start from public.triage_config where id = 1), v_senior)
  returning id into v_approval_a;

  -- Drain assertions.
  select triage_state into v_state from public.photos where id = v_photo_pending;
  if v_state <> 'not_required' then
    raise exception 'scenario 1: pending photo should be not_required after drain, got %', v_state;
  end if;

  select triage_state into v_state from public.photos where id = v_photo_in_progress;
  if v_state <> 'not_required' then
    raise exception 'scenario 1: in_progress photo should be not_required after drain, got %', v_state;
  end if;

  select triage_state into v_state from public.photos where id = v_photo_clean;
  if v_state <> 'clean' then
    raise exception 'scenario 1: clean photo should stay clean, got %', v_state;
  end if;

  select triage_state into v_state from public.photos where id = v_photo_flagged;
  if v_state <> 'flagged' then
    raise exception 'scenario 1: flagged photo should stay flagged, got %', v_state;
  end if;

  -- triage_claim_id cleared on the drained in_progress photo.
  if (select triage_claim_id from public.photos where id = v_photo_in_progress) is not null then
    raise exception 'scenario 1: triage_claim_id should be cleared on drained photo';
  end if;

  -- Claim released with reason 'location_approved'.
  select released_at, release_reason into v_released_at, v_release_reason
    from public.triage_claims where id = v_claim_active;
  if v_released_at is null then
    raise exception 'scenario 1: claim should be released after approve';
  end if;
  if v_release_reason <> 'location_approved' then
    raise exception 'scenario 1: expected release_reason=location_approved, got %', v_release_reason;
  end if;

  raise notice 'scenario 1 OK: approve drain';

  -- ── Scenario 2: Approve short-circuit on new photo ──────────────────────

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-loc-p5-postapprove')
  returning id into v_photo_late;

  select triage_state into v_state from public.photos where id = v_photo_late;
  if v_state <> 'not_required' then
    raise exception 'scenario 2: new photo at approved location should be not_required, got %', v_state;
  end if;

  raise notice 'scenario 2 OK: approve short-circuit on new photo';

  -- ── Scenario 3: Revoke reopen ────────────────────────────────────────────

  update public.location_approvals
     set revoked_at = now(),
         revoked_by = v_senior,
         revocation_reason = 'e2e test'
   where id = v_approval_a;

  -- Drained photos (pending, in_progress, late) flip back to pending.
  select triage_state into v_state from public.photos where id = v_photo_pending;
  if v_state <> 'pending' then
    raise exception 'scenario 3: drained pending should reopen to pending, got %', v_state;
  end if;

  select triage_state into v_state from public.photos where id = v_photo_in_progress;
  if v_state <> 'pending' then
    raise exception 'scenario 3: drained in_progress should reopen to pending, got %', v_state;
  end if;

  select triage_state into v_state from public.photos where id = v_photo_late;
  if v_state <> 'pending' then
    raise exception 'scenario 3: post-approve photo should reopen to pending, got %', v_state;
  end if;

  -- Clean and flagged stay (historical).
  select triage_state into v_state from public.photos where id = v_photo_clean;
  if v_state <> 'clean' then
    raise exception 'scenario 3: clean photo should stay clean across revoke, got %', v_state;
  end if;

  select triage_state into v_state from public.photos where id = v_photo_flagged;
  if v_state <> 'flagged' then
    raise exception 'scenario 3: flagged photo should stay flagged across revoke, got %', v_state;
  end if;

  -- Released claim stays released (don't time-travel reviewers).
  select released_at, release_reason into v_released_at, v_release_reason
    from public.triage_claims where id = v_claim_active;
  if v_released_at is null then
    raise exception 'scenario 3: previously-released claim should stay released';
  end if;
  if v_release_reason <> 'location_approved' then
    raise exception 'scenario 3: release_reason should not change, got %', v_release_reason;
  end if;

  raise notice 'scenario 3 OK: revoke reopen';

  -- ── Scenario 4: Late photo at revoked location lands pending ────────────

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-loc-p6-postrevoke')
  returning id into v_photo_late;

  select triage_state into v_state from public.photos where id = v_photo_late;
  if v_state <> 'pending' then
    raise exception 'scenario 4: new photo at revoked location should be pending, got %', v_state;
  end if;

  raise notice 'scenario 4 OK: late photo lands pending';

  -- ── Scenario 5: Concurrent approve (partial unique index) ────────────────

  -- Re-approve to get back into the 'approved' state.
  insert into public.location_approvals (location_id, season_start, approved_by)
  values (v_loc, (select season_first_week_start from public.triage_config where id = 1), v_senior)
  returning id into v_approval_b;

  begin
    insert into public.location_approvals (location_id, season_start, approved_by)
    values (v_loc, (select season_first_week_start from public.triage_config where id = 1), v_senior);
    raise exception 'scenario 5: concurrent approve should have been rejected';
  exception
    when unique_violation then
      raise notice 'scenario 5 OK: concurrent approve rejected (23505)';
  end;

  -- ── Scenario 6: Re-approve after revoke retains history ─────────────────

  -- After scenario 5 we already have v_approval_a (revoked) + v_approval_b (active).
  select count(*) into v_count
    from public.location_approvals
   where location_id = v_loc;

  if v_count <> 2 then
    raise exception 'scenario 6: expected 2 approval rows in history, got %', v_count;
  end if;

  select approval_status into v_status from public.locations_with_approval where id = v_loc;
  if v_status <> 'approved' then
    raise exception 'scenario 6: expected approved status with active second row, got %', v_status;
  end if;

  raise notice 'scenario 6 OK: history retained, active row is the new one';
end;
$$;

select 'e2e location approval passed' as result;

rollback;
