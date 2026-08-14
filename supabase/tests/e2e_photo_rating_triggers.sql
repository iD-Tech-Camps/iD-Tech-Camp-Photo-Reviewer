-- Photo rating trigger contract tests.
--   npx supabase db reset
--   npx supabase db query --file supabase/tests/e2e_photo_rating_triggers.sql

begin;

-- Pin the season window around today — see the same preamble in
-- e2e_triage_triggers.sql. Weeks starting outside the configured season get no
-- ordinal, so without this the role assertions below fail once the seeded
-- season has passed. least/greatest only ever widens the window.
update public.triage_config
   set season_first_week_start = least(current_date - 365, season_first_week_start),
       season_last_week_start  = greatest(current_date + 365, season_last_week_start)
 where id = 1;

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'ffffffff-1111-1111-1111-111111111101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'e2e-rating-reviewer@test.local',
  crypt('pw', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

insert into public.profiles (id, email, role)
values ('ffffffff-1111-1111-1111-111111111101', 'e2e-rating-reviewer@test.local', 'reviewer')
on conflict (id) do update set role = 'reviewer';

insert into public.divisions (id, name, smugmug_folder_id) values
  ('ffffffff-2222-2222-2222-222222222201', 'E2E Rating Division', 'e2e-rating-div')
on conflict (id) do nothing;

insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('ffffffff-2222-2222-2222-222222222202',
   'ffffffff-2222-2222-2222-222222222201',
   'E2E Rating Location', 'e2e-rating-loc')
on conflict (id) do nothing;

do $$
declare
  v_loc uuid := 'ffffffff-2222-2222-2222-222222222202';
  v_week uuid;
  v_photo uuid;
  v_claim uuid;
  v_state public.photo_rating_state;
  v_week_state public.camp_week_rating_state;
begin
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Rating Week', 'e2e-rating-w1', current_date + 7, current_date + 11)
  returning id into v_week;

  if (select rating_role from public.camp_weeks where id = v_week) <> 'first_week' then
    raise exception 'expected first_week rating_role';
  end if;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_week, 'e2e-rating-photo-1')
  returning id into v_photo;

  select rating_state into v_state from public.photos where id = v_photo;
  if v_state <> 'pending' then
    raise exception 'photo should be pending, got %', v_state;
  end if;

  insert into public.photo_rating_claims (camp_week_id, reviewer_id, slice_size)
  values (v_week, 'ffffffff-1111-1111-1111-111111111101', 10)
  returning id into v_claim;

  select rating_state into v_state from public.photos where id = v_photo;
  if v_state <> 'in_progress' then
    raise exception 'photo should be in_progress after claim, got %', v_state;
  end if;

  insert into public.photo_rating_events (photo_id, reviewer_id, claim_id, rating, quarantine_intent)
  values (v_photo, 'ffffffff-1111-1111-1111-111111111101', v_claim, 4, false);

  select rating_state into v_state from public.photos where id = v_photo;
  if v_state <> 'rated' then
    raise exception 'photo should be rated, got %', v_state;
  end if;

  if (select current_rating from public.photos where id = v_photo) <> 4 then
    raise exception 'current_rating should be 4 after first rating';
  end if;

  -- Re-rating (same reviewer "Update") overwrites current_rating.
  insert into public.photo_rating_events (photo_id, reviewer_id, claim_id, rating, quarantine_intent)
  values (v_photo, 'ffffffff-1111-1111-1111-111111111101', v_claim, 2, false);

  if (select current_rating from public.photos where id = v_photo) <> 2 then
    raise exception 'current_rating should be 2 after re-rating';
  end if;

  select rating_state into v_week_state from public.camp_weeks where id = v_week;
  if v_week_state <> 'rating_done' then
    raise exception 'week should be rating_done, got %', v_week_state;
  end if;

  raise notice 'e2e photo rating triggers OK';
end;
$$;

-- Week 3+ gets photo review only (later_week), not camp quality review.
insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('ffffffff-2222-2222-2222-222222222203',
   'ffffffff-2222-2222-2222-222222222201',
   'E2E Ordinal Location', 'e2e-ordinal-loc')
on conflict (id) do nothing;

do $$
declare
  v_loc uuid := 'ffffffff-2222-2222-2222-222222222203';
  v_w1 uuid;
  v_w2 uuid;
  v_w3 uuid;
  v_rating_role public.camp_week_triage_role;
  v_triage_role public.camp_week_triage_role;
  v_rating_state public.camp_week_rating_state;
begin
  -- These three weeks must all still be UPCOMING. This block asserts pure
  -- positional ordinals (1 / 2 / 3), and migration 49's orphan rule disqualifies
  -- any week that has fully passed while holding no photos — none of these get
  -- photos. With fixed past dates, W1 orphans out and W2 inherits ordinal 1,
  -- which is exactly how this test failed once 2026-07 slipped into the past.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Ord W1', 'e2e-ord-w1', current_date + 7, current_date + 11)
  returning id into v_w1;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Ord W2', 'e2e-ord-w2', current_date + 14, current_date + 18)
  returning id into v_w2;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Ord W3', 'e2e-ord-w3', current_date + 21, current_date + 25)
  returning id into v_w3;

  select triage_role, rating_role into v_triage_role, v_rating_role
    from public.camp_weeks where id = v_w1;
  if v_triage_role <> 'first_week' or v_rating_role <> 'first_week' then
    raise exception 'w1: expected first_week for both, got triage=% rating=%', v_triage_role, v_rating_role;
  end if;

  select triage_role, rating_role into v_triage_role, v_rating_role
    from public.camp_weeks where id = v_w2;
  if v_triage_role <> 'none' or v_rating_role <> 'none' then
    raise exception 'w2: expected none for both, got triage=% rating=%', v_triage_role, v_rating_role;
  end if;

  select triage_role, rating_role into v_triage_role, v_rating_role
    from public.camp_weeks where id = v_w3;
  if v_triage_role <> 'none' or v_rating_role <> 'later_week' then
    raise exception 'w3: expected triage none + rating later_week, got triage=% rating=%', v_triage_role, v_rating_role;
  end if;

  insert into public.photos (camp_week_id, smugmug_image_id)
  values (v_w3, 'e2e-ord-w3-photo');

  select rating_state into v_rating_state from public.camp_weeks where id = v_w3;
  if v_rating_state <> 'photos_in' then
    raise exception 'w3 after photo: expected photos_in, got %', v_rating_state;
  end if;

  raise notice 'e2e later_week ordinal OK';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cross-season rating scope (migration 52).
--
-- Rating seasons are calendar years, so prior-year weeks are rateable while
-- quality review stays bound to the configured season. Pins a deterministic
-- mid-year season window first — the file preamble widens the window by a year
-- in each direction, which would put the prior-year fixtures below the lower
-- bound of their own season and mask what this block is checking.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('ffffffff-2222-2222-2222-222222222204',
   'ffffffff-2222-2222-2222-222222222201',
   'E2E Season Location', 'e2e-season-loc')
on conflict (id) do nothing;

do $$
declare
  v_loc uuid := 'ffffffff-2222-2222-2222-222222222204';
  v_year int := extract(year from current_date)::int;
  v_prior_empty uuid;
  v_prior_w1 uuid;
  v_prior_w2 uuid;
  v_prior_w3 uuid;
  v_pre uuid;
  v_in uuid;
  v_in2 uuid;
  v_post uuid;
  v_triage public.camp_week_triage_role;
  v_rating public.camp_week_triage_role;
  v_photo_state public.photo_rating_state;
begin
  -- Mid-year season so the "keep the configured start for its own year" branch
  -- of camp_week_rating_ordinal is actually exercised.
  update public.triage_config
     set season_first_week_start = make_date(v_year, 5, 1),
         season_last_week_start  = make_date(v_year, 8, 1)
   where id = 1;

  -- Prior season. The first week is left photo-less on purpose: it has fully
  -- passed, so the orphan rule must skip it and let the next week take
  -- ordinal 1 — the same protection that applies inside the current season.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Prior empty', 'e2e-s-p0', make_date(v_year - 1, 5, 4),  make_date(v_year - 1, 5, 8))
  returning id into v_prior_empty;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Prior W1', 'e2e-s-p1', make_date(v_year - 1, 6, 1),  make_date(v_year - 1, 6, 5))
  returning id into v_prior_w1;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Prior W2', 'e2e-s-p2', make_date(v_year - 1, 6, 8),  make_date(v_year - 1, 6, 12))
  returning id into v_prior_w2;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Prior W3', 'e2e-s-p3', make_date(v_year - 1, 6, 15), make_date(v_year - 1, 6, 19))
  returning id into v_prior_w3;

  -- Current year: before the season start, inside it, and after its end.
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Pre season', 'e2e-s-c0', make_date(v_year, 3, 2),  make_date(v_year, 3, 6))
  returning id into v_pre;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'In season', 'e2e-s-c1', make_date(v_year, 5, 25), make_date(v_year, 5, 29))
  returning id into v_in;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'In season 2', 'e2e-s-c1b', make_date(v_year, 6, 8), make_date(v_year, 6, 12))
  returning id into v_in2;

  -- Third in-year week, so the post-season week lands on ordinal 3 rather than
  -- the ordinal-2 recheck slot — this asserts later_week, not just "non-none".
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Post season', 'e2e-s-c2', make_date(v_year, 9, 7), make_date(v_year, 9, 11))
  returning id into v_post;

  insert into public.photos (camp_week_id, smugmug_image_id)
  select id, 'e2e-s-photo-' || id
    from public.camp_weeks
   where location_id = v_loc and id <> v_prior_empty;

  perform public.recompute_all_triage_roles();

  -- Prior season is rateable on a calendar-year ordinal, and never triageable.
  select triage_role, rating_role into v_triage, v_rating
    from public.camp_weeks where id = v_prior_w1;
  if v_rating <> 'first_week' or v_triage <> 'none' then
    raise exception 'prior W1: expected rating first_week + triage none, got rating=% triage=%', v_rating, v_triage;
  end if;

  select rating_role into v_rating from public.camp_weeks where id = v_prior_w2;
  if v_rating <> 'none' then
    raise exception 'prior W2: expected none (recheck slot), got %', v_rating;
  end if;

  select rating_role into v_rating from public.camp_weeks where id = v_prior_w3;
  if v_rating <> 'later_week' then
    raise exception 'prior W3: expected later_week, got %', v_rating;
  end if;

  -- Orphan rule still applies across seasons: the photo-less passed week keeps
  -- no role, which is why Prior W1 above could hold ordinal 1.
  select rating_role into v_rating from public.camp_weeks where id = v_prior_empty;
  if v_rating <> 'none' then
    raise exception 'prior empty week: expected none (orphan), got %', v_rating;
  end if;

  -- Opening past seasons must not disturb the season under review: a week
  -- before the configured start still derives none, and the first in-season
  -- week still holds first_week for both workflows.
  select rating_role into v_rating from public.camp_weeks where id = v_pre;
  if v_rating <> 'none' then
    raise exception 'pre-season week: expected none, got %', v_rating;
  end if;

  select triage_role, rating_role into v_triage, v_rating
    from public.camp_weeks where id = v_in;
  if v_triage <> 'first_week' or v_rating <> 'first_week' then
    raise exception 'in-season week: expected first_week for both, got triage=% rating=%', v_triage, v_rating;
  end if;

  -- Weeks past the season end are what the sync keeps pulling; they are now
  -- rateable (ordinal 3 behind the in-season week and the recheck slot).
  select triage_role, rating_role into v_triage, v_rating
    from public.camp_weeks where id = v_post;
  if v_triage <> 'none' or v_rating <> 'later_week' then
    raise exception 'post-season week: expected triage none + rating later_week, got triage=% rating=%', v_triage, v_rating;
  end if;

  -- The role change must have fanned out to the photos, otherwise nothing is
  -- actually claimable and the whole exercise is cosmetic.
  select rating_state into v_photo_state
    from public.photos where camp_week_id = v_prior_w1 limit 1;
  if v_photo_state <> 'pending' then
    raise exception 'prior W1 photo: expected pending after backfill, got %', v_photo_state;
  end if;

  select rating_state into v_photo_state
    from public.photos where camp_week_id = v_prior_w2 limit 1;
  if v_photo_state <> 'not_required' then
    raise exception 'prior W2 photo: expected not_required, got %', v_photo_state;
  end if;

  raise notice 'e2e cross-season rating scope OK';
end;
$$;

rollback;
