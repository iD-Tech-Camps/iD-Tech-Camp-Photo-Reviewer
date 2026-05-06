-- One-off server-side check for the step-6 review wiring. Inserts an approve
-- review (with rating + positive tag) and a flag review (with quarantine=true,
-- a note, and two negative tags) using the real authenticated user's id, then
-- asserts every trigger and check constraint produced the expected side
-- effects. Wrapped in `begin; ... rollback;` so the dev queue is unaffected.
--
-- IMPORTANT: This test runs under the `authenticated` role with the user's
-- JWT claims pinned, so RLS is in force exactly as it is in production. The
-- earlier version of this test ran as the service role (the default for
-- `supabase db query`) and silently missed migration 6's trigger-vs-RLS bug:
-- the trigger's inner UPDATE on `photos` was zero-rowed by RLS, but as
-- service role the UPDATE went through and the test passed. Migration 14
-- marks those triggers SECURITY DEFINER. Don't relax the role pin below.
--
-- Run with:
--   npx supabase db query --file supabase/tests/e2e_review_flow.sql --linked
--
-- Last row should be `e2e review flow passed`. Any earlier raise is a fail.

begin;

set local role authenticated;
set local request.jwt.claims to
  '{"sub": "1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589", "role": "authenticated"}';

do $$
declare
  v_user_id uuid := '1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589'; -- zeckstein@idtech.com
  v_approve_photo uuid;
  v_flag_photo    uuid;
  v_approve_rev   uuid;
  v_flag_rev      uuid;
  v_status        text;
  v_quarantined   boolean;
  v_points        int;
  v_last_before   timestamptz;
  v_last_after    timestamptz;
  v_tag_count     int;
begin
  select last_active_at into v_last_before
  from public.profiles where id = v_user_id;

  select id into v_approve_photo from public.photos where smugmug_image_id = 'placeholder-IMG_4821';
  select id into v_flag_photo    from public.photos where smugmug_image_id = 'placeholder-IMG_4822';

  -- ── Approve flow ─────────────────────────────────────────────
  insert into public.reviews (photo_id, reviewer_id, decision, rating)
  values (v_approve_photo, v_user_id, 'approve', 5)
  returning id into v_approve_rev;

  insert into public.review_tags (review_id, tag_id)
  values (v_approve_rev, 'hero-shot');

  select current_status::text, is_quarantined into v_status, v_quarantined
  from public.photos where id = v_approve_photo;
  if v_status <> 'approved' then
    raise exception 'approve: expected current_status=approved, got %', v_status;
  end if;
  if v_quarantined <> false then
    raise exception 'approve: expected is_quarantined=false, got %', v_quarantined;
  end if;

  select points_awarded into v_points from public.reviews where id = v_approve_rev;
  if v_points <> 10 then
    raise exception 'approve: expected points_awarded=10 (default approve_points), got %', v_points;
  end if;

  select count(*) into v_tag_count from public.review_tags where review_id = v_approve_rev;
  if v_tag_count <> 1 then
    raise exception 'approve: expected 1 review_tags row, got %', v_tag_count;
  end if;

  -- ── Flag flow with quarantine ────────────────────────────────
  insert into public.reviews (photo_id, reviewer_id, decision, note, quarantine)
  values (v_flag_photo, v_user_id, 'flag', 'server-side e2e test', true)
  returning id into v_flag_rev;

  insert into public.review_tags (review_id, tag_id) values
    (v_flag_rev, 'blurry'),
    (v_flag_rev, 'bad-lighting');

  select current_status::text, is_quarantined into v_status, v_quarantined
  from public.photos where id = v_flag_photo;
  if v_status <> 'flagged' then
    raise exception 'flag: expected current_status=flagged, got %', v_status;
  end if;
  if v_quarantined <> true then
    raise exception 'flag(quarantine=true): expected is_quarantined=true, got %', v_quarantined;
  end if;

  select points_awarded into v_points from public.reviews where id = v_flag_rev;
  if v_points <> 15 then
    raise exception 'flag: expected points_awarded=15 (default flag_points), got %', v_points;
  end if;

  select count(*) into v_tag_count from public.review_tags where review_id = v_flag_rev;
  if v_tag_count <> 2 then
    raise exception 'flag: expected 2 review_tags rows, got %', v_tag_count;
  end if;

  -- ── last_active_at bump (set by trigger 4) ───────────────────
  select last_active_at into v_last_after
  from public.profiles where id = v_user_id;
  if v_last_after <= v_last_before then
    raise exception 'last_active_at not bumped: before=%, after=%', v_last_before, v_last_after;
  end if;

  -- ── Check constraint: rating only on approves ─────────────────
  begin
    insert into public.reviews (photo_id, reviewer_id, decision, rating)
    values (v_flag_photo, v_user_id, 'flag', 4);
    raise exception 'check constraint missed: flag with rating should have failed';
  exception when check_violation then
    null;
  end;

  -- ── Check constraint: quarantine only on flags ────────────────
  begin
    insert into public.reviews (photo_id, reviewer_id, decision, quarantine)
    values (v_approve_photo, v_user_id, 'approve', true);
    raise exception 'check constraint missed: approve with quarantine should have failed';
  exception when check_violation then
    null;
  end;

  raise notice 'approve OK: status=%, quarantined=%, points=%, tags=1', 'approved', false, 10;
  raise notice 'flag OK: status=%, quarantined=%, points=%, tags=2', 'flagged', true, 15;
  raise notice 'last_active_at bumped %  ->  %', v_last_before, v_last_after;
end;
$$;

select 'e2e review flow passed' as result;

rollback;
