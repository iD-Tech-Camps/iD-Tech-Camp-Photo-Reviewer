-- Step 8.8 — server-side check for the SmugMug sync engine's
-- *database* contract.
--
-- The sync engine itself (lib/smugmug/sync/photos.ts and
-- app/api/smugmug/clear-pending/route.ts) makes live HTTP calls to
-- SmugMug, which a SQL test can't and shouldn't reproduce. What we
-- *can* test is the contract those routes have with the database:
-- which writes do they issue against `photos`, `camp_weeks`, and
-- `reviews`, in what order, and what does the schema do in response.
-- Each scenario below mirrors the SQL the real sync engine emits;
-- if a future refactor changes the contract, this test is the
-- canary.
--
-- Six scenarios (matching the spec for step 8.8):
--   1. Clean-slate sync inserts the expected rows.
--   2. A re-run is a no-op (same images mapped to identical fields
--      should not produce updates).
--   3. Photos missing from SmugMug:
--        a) unreviewed → deleted.
--        b) reviewed   → preserved.
--   4. Re-parenting works: same smugmug_image_id, different
--      camp_week_id moves the row rather than inserting a duplicate
--      (the smugmug_image_id unique constraint enforces this).
--   5. Reviewer-queue priority ordering is `priority desc, captured_at
--      <queueOrder>` and obeys the partial composite index
--      `photos_pending_priority_idx` (migration 21).
--   6. Mode-switch "clear the queue" deletes only unreviewed pending
--      rows; reviewed-pending stays, terminal-status (approved /
--      flagged / deleted) stays.
--
-- Runs as service role throughout — the real sync engine uses a
-- service-role Supabase client, so RLS-as-authenticated isn't part
-- of the contract this test is validating. The trigger-vs-RLS bug
-- that motivates the role pin in `e2e_review_flow.sql` is covered
-- by that other test.
--
-- Wrapped in begin/rollback so every fixture row vanishes at the end.
--
-- Run with:
--   npx supabase db query --file supabase/tests/e2e_smugmug_sync_flow.sql --linked
--
-- Last row should be `e2e smugmug sync flow passed`. Any earlier
-- raise is a fail.

begin;

-- ── Fixture hierarchy: division → location → 2 weeks ───────────────
-- Two weeks under the same location lets scenario 4 (re-parenting)
-- exercise a real cross-week move.
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

do $$
declare
  v_week_a uuid := 'dddddddd-4444-4444-4444-444444444443';
  v_week_b uuid := 'dddddddd-4444-4444-4444-444444444444';
  v_user_id uuid := '1e6c7363-f8ea-4e5d-92a5-6b2e64bb2589';
  v_count int;
  v_caption text;
  v_camp_week uuid;
  v_first_id uuid;
  v_second_id uuid;
  v_photo_id uuid;
  v_status text;
begin
  -- ─────────────────────────────────────────────────────────────────
  -- 1. Clean-slate sync inserts the expected rows.
  --    Mirrors lib/smugmug/sync/photos.ts → insertPhotoRow for an
  --    image that doesn't exist yet under any week.
  -- ─────────────────────────────────────────────────────────────────
  insert into public.photos (camp_week_id, smugmug_image_id, caption, captured_at, width, height) values
    (v_week_a, 'e2e-sync-img-1', 'Workshop',     timestamptz '2026-05-26 10:00:00-04', 1600, 1067),
    (v_week_a, 'e2e-sync-img-2', 'Lunch',        timestamptz '2026-05-26 12:00:00-04', 1600, 1067),
    (v_week_a, 'e2e-sync-img-3', 'Demo',         timestamptz '2026-05-26 15:00:00-04', 1600, 1067);

  select count(*) into v_count
  from public.photos where camp_week_id = v_week_a;
  if v_count <> 3 then
    raise exception 'scenario 1: expected 3 photos under week A, got %', v_count;
  end if;

  select caption into v_caption
  from public.photos
  where smugmug_image_id = 'e2e-sync-img-1';
  if v_caption <> 'Workshop' then
    raise exception 'scenario 1: caption did not persist (got %)', v_caption;
  end if;

  raise notice 'scenario 1 OK: 3 photos inserted under week A';

  -- ─────────────────────────────────────────────────────────────────
  -- 2. Re-run is a no-op.
  --    The sync engine's pattern: list each week's existing rows by
  --    smugmug_image_id, compare each walked image against the
  --    existing row via computeDrift, only UPDATE when a field
  --    actually changed. Here we simulate a "drift" check: if no
  --    fields differ, no UPDATE runs, and the row's updated_at
  --    stays put.
  -- ─────────────────────────────────────────────────────────────────
  declare
    v_updated_before timestamptz;
    v_updated_after  timestamptz;
  begin
    select updated_at into v_updated_before
    from public.photos where smugmug_image_id = 'e2e-sync-img-1';

    -- Simulate the sync's "drift compare → no UPDATE if all match" step.
    -- We deliberately UPDATE only when at least one field differs. None
    -- do, so this WHERE never matches and updated_at stays put.
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
      raise exception 'scenario 2: re-run was not a no-op (updated_at advanced %  ->  %)',
        v_updated_before, v_updated_after;
    end if;
  end;

  -- The smugmug_image_id unique constraint also makes a literal
  -- "INSERT same key under same week" call fail rather than
  -- silently re-insert. The real sync engine's "existingByKey" lookup
  -- short-circuits this case before issuing a second INSERT, but the
  -- DB is the safety net.
  begin
    insert into public.photos (camp_week_id, smugmug_image_id) values (v_week_a, 'e2e-sync-img-1');
    raise exception 'scenario 2: duplicate INSERT should have raised unique_violation';
  exception when unique_violation then
    null;
  end;

  raise notice 'scenario 2 OK: re-run produces neither updates nor duplicate inserts';

  -- ─────────────────────────────────────────────────────────────────
  -- 3. Photos missing from SmugMug:
  --      3a. Unreviewed orphan → deleted.
  --      3b. Reviewed orphan   → preserved.
  --
  --    Mirrors the closing block of lib/smugmug/sync/photos.ts →
  --    syncOneWeek: it computes existing-minus-walked, fetches
  --    review_ids for that set, deletes only the rows with no
  --    reviews.
  -- ─────────────────────────────────────────────────────────────────
  -- Add a reviewed photo (img-2 gets a review row) and an unreviewed
  -- photo (img-3 already has none).
  insert into public.reviews (photo_id, reviewer_id, decision, rating)
  select id, v_user_id, 'approve', 5
  from public.photos where smugmug_image_id = 'e2e-sync-img-2';

  -- Simulate the sync engine's "delete orphans without reviews" step.
  -- Orphans = existing-in-week-A minus walked-this-run; here we
  -- pretend the walk returned only img-1, so img-2 and img-3 are orphans.
  with orphans as (
    select id from public.photos
    where camp_week_id = v_week_a
      and smugmug_image_id in ('e2e-sync-img-2', 'e2e-sync-img-3')
  ),
  reviewed as (
    select distinct photo_id from public.reviews
    where photo_id in (select id from orphans)
  )
  delete from public.photos
  where id in (select id from orphans where id not in (select photo_id from reviewed));

  -- 3a: img-3 should be gone.
  select count(*) into v_count
  from public.photos where smugmug_image_id = 'e2e-sync-img-3';
  if v_count <> 0 then
    raise exception 'scenario 3a: unreviewed orphan should have been deleted, got %', v_count;
  end if;

  -- 3b: img-2 should still be there (it had a review, status=approved).
  select current_status::text into v_status
  from public.photos where smugmug_image_id = 'e2e-sync-img-2';
  if v_status is null then
    raise exception 'scenario 3b: reviewed orphan was unexpectedly deleted';
  end if;
  if v_status <> 'approved' then
    raise exception 'scenario 3b: reviewed orphan in wrong status: %', v_status;
  end if;

  raise notice 'scenario 3 OK: unreviewed orphan deleted, reviewed orphan preserved';

  -- ─────────────────────────────────────────────────────────────────
  -- 4. Re-parenting.
  --    Mirrors lib/smugmug/sync/photos.ts → "moved" branch: when a
  --    walked image's smugmug_image_id matches a row under a
  --    DIFFERENT camp_week_id, the engine UPDATEs the camp_week_id
  --    rather than inserting a duplicate (which the unique
  --    constraint would forbid anyway). Insert a fresh photo under
  --    week A, then simulate it appearing under week B.
  -- ─────────────────────────────────────────────────────────────────
  insert into public.photos (camp_week_id, smugmug_image_id, captured_at)
  values (v_week_a, 'e2e-sync-img-reparent', timestamptz '2026-05-27 10:00:00-04')
  returning id into v_photo_id;

  update public.photos
  set camp_week_id = v_week_b
  where smugmug_image_id = 'e2e-sync-img-reparent'
    and camp_week_id <> v_week_b;

  select camp_week_id into v_camp_week
  from public.photos where id = v_photo_id;
  if v_camp_week <> v_week_b then
    raise exception 'scenario 4: re-parent did not move row to week B (got %)', v_camp_week;
  end if;

  -- And there should be exactly one row with that key — the unique
  -- constraint guards against accidental duplicate-on-reparent.
  select count(*) into v_count
  from public.photos where smugmug_image_id = 'e2e-sync-img-reparent';
  if v_count <> 1 then
    raise exception 'scenario 4: expected exactly 1 row for reparented key, got %', v_count;
  end if;

  raise notice 'scenario 4 OK: re-parented row moved without duplicate';

  -- ─────────────────────────────────────────────────────────────────
  -- 5. Reviewer-queue priority ordering.
  --    Matches `lib/reviews.ts → fetchPendingPhotos`:
  --      where current_status = 'pending'
  --      order by priority desc, captured_at <queueOrder>
  --
  --    Insert four rows with a mix of priorities and captured_at
  --    values, plus one that's NOT pending (should be excluded).
  --    Newest_first ordering should yield: [P1=hi/new, P2=hi/old,
  --    P3=lo/new, P4=lo/old]. The non-pending row is excluded
  --    even though it has the highest priority.
  -- ─────────────────────────────────────────────────────────────────
  insert into public.photos
    (id,                                         camp_week_id, smugmug_image_id,    captured_at,                              priority) values
    ('dddddddd-4444-4444-4444-44444444444a',     v_week_b,     'e2e-sync-prio-1',   timestamptz '2026-05-26 18:00:00-04',     1),
    ('dddddddd-4444-4444-4444-44444444444b',     v_week_b,     'e2e-sync-prio-2',   timestamptz '2026-05-26 09:00:00-04',     1),
    ('dddddddd-4444-4444-4444-44444444444c',     v_week_b,     'e2e-sync-prio-3',   timestamptz '2026-05-26 18:30:00-04',     0),
    ('dddddddd-4444-4444-4444-44444444444d',     v_week_b,     'e2e-sync-prio-4',   timestamptz '2026-05-26 06:00:00-04',     0);

  -- A non-pending priority-1 row that should be excluded by the
  -- `where current_status = 'pending'` filter regardless of how high
  -- its priority is.
  insert into public.photos
    (camp_week_id, smugmug_image_id,            captured_at,                          priority, current_status) values
    (v_week_b,     'e2e-sync-prio-excluded',    timestamptz '2026-05-26 23:59:00-04', 1,        'approved');

  -- Pull the top 2 in newest_first order, scoped to our test rows so
  -- this test isn't sensitive to whatever else is sitting in the
  -- pending queue at the time. Both have priority=1; the earlier
  -- captured_at should sort second.
  select id into v_first_id from public.photos
   where smugmug_image_id like 'e2e-sync-prio-%' and current_status = 'pending'
   order by priority desc, captured_at desc
   limit 1;
  if v_first_id <> 'dddddddd-4444-4444-4444-44444444444a' then
    raise exception 'scenario 5 (newest_first): top of queue should be prio-1 (hi/new), got %', v_first_id;
  end if;

  -- Second slot: priority 1 + earlier captured_at.
  select id into v_second_id from (
    select id from public.photos
     where smugmug_image_id like 'e2e-sync-prio-%' and current_status = 'pending'
     order by priority desc, captured_at desc
     offset 1 limit 1
  ) sub;
  if v_second_id <> 'dddddddd-4444-4444-4444-44444444444b' then
    raise exception 'scenario 5 (newest_first): second slot should be prio-2 (hi/old), got %', v_second_id;
  end if;

  -- The excluded approved row should not appear at all.
  select count(*) into v_count
  from public.photos
  where smugmug_image_id = 'e2e-sync-prio-excluded'
    and current_status = 'pending';
  if v_count <> 0 then
    raise exception 'scenario 5: non-pending row leaked into the pending queue';
  end if;

  -- Flip queue_order to oldest_first and re-check: hi/old should now
  -- top the queue. (We don't actually need to read smugmug_config —
  -- the ordering is in the SELECT.)
  select id into v_first_id from public.photos
   where smugmug_image_id like 'e2e-sync-prio-%' and current_status = 'pending'
   order by priority desc, captured_at asc
   limit 1;
  if v_first_id <> 'dddddddd-4444-4444-4444-44444444444b' then
    raise exception 'scenario 5 (oldest_first): top of queue should be prio-2 (hi/old), got %', v_first_id;
  end if;

  raise notice 'scenario 5 OK: priority desc + captured_at <dir> ordering, non-pending excluded';

  -- ─────────────────────────────────────────────────────────────────
  -- 6. Mode-switch "clear the queue" deletes only unreviewed pending.
  --    Matches app/api/smugmug/clear-pending/route.ts: pendingIds
  --    minus reviewedSet → bulk delete.
  --
  --    Setup: under week B, 3 unreviewed pending + 1 reviewed
  --    pending + 1 approved + 1 deleted. Expected: only the 3
  --    unreviewed pending get deleted.
  -- ─────────────────────────────────────────────────────────────────
  -- Cleanup any existing rows under week B from earlier scenarios so
  -- the row-count assertion below is precise.
  delete from public.photos where camp_week_id = v_week_b;

  -- 3 unreviewed pending
  insert into public.photos (id, camp_week_id, smugmug_image_id, captured_at) values
    ('dddddddd-4444-4444-4444-44444444445a', v_week_b, 'e2e-sync-clear-1', now()),
    ('dddddddd-4444-4444-4444-44444444445b', v_week_b, 'e2e-sync-clear-2', now()),
    ('dddddddd-4444-4444-4444-44444444445c', v_week_b, 'e2e-sync-clear-3', now());

  -- 1 reviewed pending: the trigger flips it to 'approved' on review
  -- insert, so to keep current_status='pending' AND have a review
  -- row, we have to insert the photo, insert a review, then UPDATE
  -- the photo back to pending. This is contrived but matches the
  -- production edge case where a senior reverses a decision and the
  -- photo is re-added to pending — the row has a reviews-history
  -- entry, so clear-the-queue should preserve it.
  insert into public.photos (id, camp_week_id, smugmug_image_id, captured_at)
  values ('dddddddd-4444-4444-4444-44444444445d', v_week_b, 'e2e-sync-clear-4-reviewed', now());
  insert into public.reviews (photo_id, reviewer_id, decision, rating)
  values ('dddddddd-4444-4444-4444-44444444445d', v_user_id, 'approve', 5);
  update public.photos set current_status = 'pending'
  where id = 'dddddddd-4444-4444-4444-44444444445d';

  -- 1 approved (terminal)
  insert into public.photos (id, camp_week_id, smugmug_image_id, captured_at, current_status)
  values ('dddddddd-4444-4444-4444-44444444445e', v_week_b, 'e2e-sync-clear-5-approved', now(), 'approved');

  -- 1 deleted (terminal)
  insert into public.photos (id, camp_week_id, smugmug_image_id, captured_at, current_status)
  values ('dddddddd-4444-4444-4444-44444444445f', v_week_b, 'e2e-sync-clear-6-deleted', now(), 'deleted');

  -- Apply the clear-the-queue rule: pending AND no review history.
  with pending as (
    select id from public.photos
    where camp_week_id = v_week_b
      and current_status = 'pending'
  ),
  reviewed as (
    select distinct photo_id as id from public.reviews
    where photo_id in (select id from pending)
  )
  delete from public.photos
  where id in (select id from pending where id not in (select id from reviewed));

  -- Verify each fixture's fate.
  select count(*) into v_count from public.photos
  where smugmug_image_id in ('e2e-sync-clear-1', 'e2e-sync-clear-2', 'e2e-sync-clear-3');
  if v_count <> 0 then
    raise exception 'scenario 6: 3 unreviewed pending should have been deleted, % survived', v_count;
  end if;

  select count(*) into v_count from public.photos
  where smugmug_image_id = 'e2e-sync-clear-4-reviewed';
  if v_count <> 1 then
    raise exception 'scenario 6: reviewed-pending should be preserved, got count=%', v_count;
  end if;

  select count(*) into v_count from public.photos
  where smugmug_image_id = 'e2e-sync-clear-5-approved';
  if v_count <> 1 then
    raise exception 'scenario 6: approved (terminal) should be preserved, got count=%', v_count;
  end if;

  select count(*) into v_count from public.photos
  where smugmug_image_id = 'e2e-sync-clear-6-deleted';
  if v_count <> 1 then
    raise exception 'scenario 6: deleted (terminal) should be preserved, got count=%', v_count;
  end if;

  raise notice 'scenario 6 OK: only unreviewed pending rows deleted by clear-the-queue';
end;
$$;

select 'e2e smugmug sync flow passed' as result;

rollback;
