-- Server-side check for the step-6 FlagReview wiring. Exercises:
--   1. Flag transition (a flag review puts a photo into 'flagged' status)
--   2. The join that powers fetchFlaggedPhotos in lib/reviews.ts —
--      photos -> camp_weeks -> locations -> divisions, plus latest review
--      with its profile and review_tags
--   3. Senior accept (decision='approve' on a flagged photo restores it
--      to 'approved', is_quarantined back to false)
--   4. Senior delete (decision='delete' moves photo to 'deleted')
--
-- The review inserts run under the authenticated role with JWT claims
-- pinned (see e2e_review_flow.sql for the role-pin rationale).
-- Wrapped in begin/rollback so the dev queue is untouched. Last row
-- should be 'flag review flow passed'.
--
-- Step 8.8 (May 2026): the test used to depend on the placeholder
-- photos seeded by migration 13. Migration 25 dropped those, so the
-- test now seeds its own division/location/week/photo fixtures up
-- front (under the service role) before flipping to authenticated.
-- The fixture division name is intentionally distinct from any real
-- one so the join assertion below catches accidental cross-talk.

begin;

-- ── Fixture rows (service role) ─────────────────────────────────────
insert into public.divisions (id, name, smugmug_folder_id) values
  ('bbbbbbbb-2222-2222-2222-222222222221', 'E2E Flag Test Division', 'e2e-flag-div');
insert into public.locations (id, division_id, name, smugmug_folder_id) values
  ('bbbbbbbb-2222-2222-2222-222222222222',
   'bbbbbbbb-2222-2222-2222-222222222221',
   'E2E Flag Test Location',
   'e2e-flag-loc');
insert into public.camp_weeks (id, location_id, name, smugmug_folder_id, starts_on, ends_on) values
  ('bbbbbbbb-2222-2222-2222-222222222223',
   'bbbbbbbb-2222-2222-2222-222222222222',
   'E2E Flag Test Week',
   'e2e-flag-week',
   current_date - 1,
   current_date + 5);
insert into public.photos (id, camp_week_id, smugmug_image_id, captured_at) values
  ('bbbbbbbb-2222-2222-2222-222222222224',
   'bbbbbbbb-2222-2222-2222-222222222223',
   'e2e-flag-img-flag',
   now()),
  ('bbbbbbbb-2222-2222-2222-222222222225',
   'bbbbbbbb-2222-2222-2222-222222222223',
   'e2e-flag-img-delete',
   now());

-- ── Switch to authenticated role for the review inserts ────────────
set local role authenticated;
set local request.jwt.claims to
  '{"sub": "1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589", "role": "authenticated"}';

do $$
declare
  v_user_id uuid := '1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589'; -- zeckstein@idtech.com
  v_flag_photo  uuid := 'bbbbbbbb-2222-2222-2222-222222222224';
  v_del_photo   uuid := 'bbbbbbbb-2222-2222-2222-222222222225';
  v_flag_rev    uuid;
  v_accept_rev  uuid;
  v_del_flag    uuid;
  v_del_rev     uuid;
  v_status      text;
  v_quarantined boolean;
  v_join_count  int;
  v_join_div    text;
  v_join_loc    text;
  v_join_tag_n  int;
begin
  -- ── 1. Flag the first photo (with quarantine + 2 tags + a note) ────────
  insert into public.reviews (photo_id, reviewer_id, decision, note, quarantine)
  values (v_flag_photo, v_user_id, 'flag', 'needs senior review', true)
  returning id into v_flag_rev;
  insert into public.review_tags (review_id, tag_id) values
    (v_flag_rev, 'consent'),
    (v_flag_rev, 'minor-ident');

  select current_status::text, is_quarantined into v_status, v_quarantined
  from public.photos where id = v_flag_photo;
  if v_status <> 'flagged' or v_quarantined <> true then
    raise exception 'flag transition failed: status=%, quarantined=%', v_status, v_quarantined;
  end if;

  -- ── 2. Verify the FlagReview join query returns the row ────────────────
  -- Mirrors the shape of the PostgREST select in lib/reviews.ts.
  with latest_review as (
    select distinct on (r.photo_id)
      r.photo_id, r.id, r.decision, r.note, r.quarantine, r.created_at, r.reviewer_id
    from public.reviews r
    order by r.photo_id, r.created_at desc
  )
  select count(*),
         max(d.name),
         max(l.name),
         max((select count(*)::int from public.review_tags where review_id = lr.id))
    into v_join_count, v_join_div, v_join_loc, v_join_tag_n
  from public.photos p
  join public.camp_weeks cw on cw.id = p.camp_week_id
  join public.locations  l  on l.id = cw.location_id
  join public.divisions  d  on d.id = l.division_id
  join latest_review     lr on lr.photo_id = p.id
  join public.profiles   pr on pr.id = lr.reviewer_id
  where p.current_status = 'flagged' and lr.decision = 'flag'
    and p.id = v_flag_photo;

  if v_join_count <> 1 then
    raise exception 'flag join: expected 1 row, got %', v_join_count;
  end if;
  if v_join_div <> 'E2E Flag Test Division' or v_join_loc <> 'E2E Flag Test Location' then
    raise exception 'flag join: wrong division/location: % / %', v_join_div, v_join_loc;
  end if;
  if v_join_tag_n <> 2 then
    raise exception 'flag join: expected 2 review_tags, got %', v_join_tag_n;
  end if;

  -- ── 3. Senior accept: insert approve review, photo returns to 'approved' ──
  insert into public.reviews (photo_id, reviewer_id, decision)
  values (v_flag_photo, v_user_id, 'approve')
  returning id into v_accept_rev;

  select current_status::text, is_quarantined into v_status, v_quarantined
  from public.photos where id = v_flag_photo;
  if v_status <> 'approved' then
    raise exception 'senior accept: expected current_status=approved, got %', v_status;
  end if;
  if v_quarantined <> false then
    raise exception 'senior accept: expected is_quarantined=false (released), got %', v_quarantined;
  end if;

  -- ── 4. Senior delete: flag a different photo first, then delete it ────
  insert into public.reviews (photo_id, reviewer_id, decision, note)
  values (v_del_photo, v_user_id, 'flag', 'will be deleted')
  returning id into v_del_flag;

  insert into public.reviews (photo_id, reviewer_id, decision)
  values (v_del_photo, v_user_id, 'delete')
  returning id into v_del_rev;

  select current_status::text, is_quarantined into v_status, v_quarantined
  from public.photos where id = v_del_photo;
  if v_status <> 'deleted' then
    raise exception 'senior delete: expected current_status=deleted, got %', v_status;
  end if;
  if v_quarantined <> false then
    raise exception 'senior delete: expected is_quarantined=false, got %', v_quarantined;
  end if;

  raise notice 'flag transition OK';
  raise notice 'flag join OK: division=%, location=%, tags=%', v_join_div, v_join_loc, v_join_tag_n;
  raise notice 'senior accept OK: status=approved, quarantined=false';
  raise notice 'senior delete OK: status=deleted';
end;
$$;

select 'flag review flow passed' as result;

rollback;
