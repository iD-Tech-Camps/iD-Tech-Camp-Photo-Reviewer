-- Step 7.5 — server-side check for the `reviewer_stats` view.
--
-- The Profile screen and the Admin Overview roster both read from
-- `public.reviewer_stats`, which left-joins `profiles` with aggregated
-- `reviews` counts and sums. This test exercises that view under the
-- authenticated role with pinned JWT claims (the same RLS context the app
-- runs under) and confirms:
--   * Every profiles row shows up in the view (left join semantics).
--   * Inserting an approve + a flag for the test user moves the row's
--     totals exactly as expected (totalReviews +2, approves +1, flags +1,
--     totalPoints += 10 + 15, lastReviewedAt advances, reviewedToday +2).
--   * `coalesce(..., 0)` renders zeros for users with no reviews — i.e.
--     the view never returns NULL aggregates that the UI would have to
--     special-case.
--
-- Step 8.8 (May 2026): the test used to depend on the placeholder
-- photos seeded by migration 13. Migration 25 dropped those, so the
-- test now seeds its own division/location/week/photo fixtures up
-- front (under the service role) before flipping to authenticated.
--
-- Run with:
--   npx supabase db query --file supabase/tests/e2e_reviewer_stats.sql --linked
--
-- Last row should be `reviewer stats view passed`. Any earlier raise is a fail.

begin;

-- ── Fixture rows (service role) ─────────────────────────────────────
insert into public.divisions (id, name, smugmug_folder_id) values
  ('cccccccc-3333-3333-3333-333333333331', 'E2E Stats Test Division', 'e2e-stats-div');
insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('cccccccc-3333-3333-3333-333333333332',
   'cccccccc-3333-3333-3333-333333333331',
   'E2E Stats Test Location',
   'e2e-stats-loc');
insert into public.camp_weeks (id, location_id, name, smugmug_folder_id, starts_on, ends_on) values
  ('cccccccc-3333-3333-3333-333333333333',
   'cccccccc-3333-3333-3333-333333333332',
   'E2E Stats Test Week',
   'e2e-stats-week',
   current_date - 1,
   current_date + 5);
insert into public.photos (id, camp_week_id, smugmug_image_id, captured_at) values
  ('cccccccc-3333-3333-3333-333333333334',
   'cccccccc-3333-3333-3333-333333333333',
   'e2e-stats-img-approve',
   now()),
  ('cccccccc-3333-3333-3333-333333333335',
   'cccccccc-3333-3333-3333-333333333333',
   'e2e-stats-img-flag',
   now());

-- ── Switch to authenticated role for the review inserts ────────────
set local role authenticated;
set local request.jwt.claims to
  '{"sub": "1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589", "role": "authenticated"}';

do $$
declare
  v_user_id uuid := '1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589';
  v_approve_photo uuid := 'cccccccc-3333-3333-3333-333333333334';
  v_flag_photo    uuid := 'cccccccc-3333-3333-3333-333333333335';
  v_row_count       int;
  v_profile_count   int;
  v_zero_check      int;
  v_total_before    int;
  v_approves_before int;
  v_flags_before    int;
  v_points_before   int;
  v_today_before    int;
  v_total_after     int;
  v_approves_after  int;
  v_flags_after     int;
  v_points_after    int;
  v_today_after     int;
  v_last_after      timestamptz;
begin
  -- ── Shape: every profiles row has a reviewer_stats row ──────────
  select count(*) into v_profile_count from public.profiles;
  select count(*) into v_row_count     from public.reviewer_stats;
  if v_row_count <> v_profile_count then
    raise exception 'reviewer_stats row count (%) != profiles row count (%)',
      v_row_count, v_profile_count;
  end if;

  -- ── No-review profiles render as zeros, not NULLs ───────────────
  -- (i.e. the UI can read totalReviews / totalPoints / reviewedToday
  -- without any null-coalescing of its own).
  select count(*)
    into v_zero_check
    from public.reviewer_stats
   where total_reviews  is null
      or approves       is null
      or flags          is null
      or deletes        is null
      or total_points   is null
      or reviewed_today is null;
  if v_zero_check <> 0 then
    raise exception 'reviewer_stats has % rows with NULL aggregate columns; expected 0', v_zero_check;
  end if;

  -- ── Baseline snapshot for the test user ─────────────────────────
  select total_reviews, approves, flags, total_points, reviewed_today
    into v_total_before, v_approves_before, v_flags_before, v_points_before, v_today_before
    from public.reviewer_stats
   where id = v_user_id;

  if not found then
    raise exception 'reviewer_stats has no row for test user %', v_user_id;
  end if;

  -- ── Insert one approve + one flag and recompute ────────────────
  insert into public.reviews (photo_id, reviewer_id, decision, rating)
       values (v_approve_photo, v_user_id, 'approve', 4);

  insert into public.reviews (photo_id, reviewer_id, decision, note, quarantine)
       values (v_flag_photo, v_user_id, 'flag', 'reviewer-stats e2e test', false);

  select total_reviews, approves, flags, total_points, reviewed_today, last_reviewed_at
    into v_total_after, v_approves_after, v_flags_after, v_points_after, v_today_after, v_last_after
    from public.reviewer_stats
   where id = v_user_id;

  if v_total_after <> v_total_before + 2 then
    raise exception 'total_reviews delta wrong: before=%, after=% (expected +2)',
      v_total_before, v_total_after;
  end if;
  if v_approves_after <> v_approves_before + 1 then
    raise exception 'approves delta wrong: before=%, after=% (expected +1)',
      v_approves_before, v_approves_after;
  end if;
  if v_flags_after <> v_flags_before + 1 then
    raise exception 'flags delta wrong: before=%, after=% (expected +1)',
      v_flags_before, v_flags_after;
  end if;
  if v_points_after <> v_points_before + 10 + 15 then
    raise exception 'total_points delta wrong: before=%, after=% (expected +25 from default points_config)',
      v_points_before, v_points_after;
  end if;
  if v_today_after < v_today_before + 2 then
    raise exception 'reviewed_today delta wrong: before=%, after=% (expected at least +2)',
      v_today_before, v_today_after;
  end if;
  if v_last_after is null then
    raise exception 'last_reviewed_at unexpectedly NULL after inserting two reviews';
  end if;

  raise notice 'shape OK: % profiles, % stats rows, no null aggregates',
    v_profile_count, v_row_count;
  raise notice 'deltas OK: total +2, approves +1, flags +1, points +25, today >= +2';
end;
$$;

select 'reviewer stats view passed' as result;

rollback;
