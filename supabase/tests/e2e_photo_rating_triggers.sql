-- Photo rating trigger contract tests.
--   npx supabase db reset
--   npx supabase db query --file supabase/tests/e2e_photo_rating_triggers.sql

begin;

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
  values (v_loc, 'Rating Week', 'e2e-rating-w1', date '2026-06-01', date '2026-06-05')
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
  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Ord W1', 'e2e-ord-w1', date '2026-07-06', date '2026-07-10')
  returning id into v_w1;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Ord W2', 'e2e-ord-w2', date '2026-07-13', date '2026-07-17')
  returning id into v_w2;

  insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
  values (v_loc, 'Ord W3', 'e2e-ord-w3', date '2026-07-20', date '2026-07-24')
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

rollback;
