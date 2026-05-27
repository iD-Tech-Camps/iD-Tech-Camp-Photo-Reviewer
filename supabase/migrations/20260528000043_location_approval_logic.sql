-- Location approval — Phase 2 (part 2 of 2: triggers + RPCs).
-- See LOCATION_APPROVAL_SPEC §4, §5b.
--
-- This migration is the substantive behavior swap. It:
--   1. Drops two legacy triggers (first_senior_touch, after_update_signoff)
--      that drove the senior_review/complete state transitions.
--   2. Modifies the photo-insert trigger to short-circuit when the parent
--      location is approved (new photos land not_required).
--   3. Modifies the claim-release trigger to route drained photos to
--      not_required when the claim's release_reason is 'location_approved'.
--   4. Modifies the claim-stamp trigger to drop the deprecated
--      sampled_for_burst order and switch to newest-first.
--   5. Adds the drain trigger on location_approvals insert.
--   6. Adds the reopen trigger on location_approvals revoke.
--   7. Adds approve_location / revoke_location SECURITY DEFINER RPCs so
--      senior/admin callers can write through RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop legacy signoff side-effect triggers.
-- The senior_review/complete states aren't assigned anymore; approval lives
-- on locations now.
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists tg_camp_weeks_after_update_first_senior_touch on public.camp_weeks;
drop function if exists public.tg_camp_weeks_after_update_first_senior_touch();

drop trigger if exists tg_camp_weeks_after_update_signoff on public.camp_weeks;
drop function if exists public.tg_camp_weeks_after_update_signoff();

-- triage_maybe_enter_senior_review is still called by the events trigger for
-- senior_unflag and other senior kinds — keep the function but make it a
-- no-op so we don't have to rewrite the events trigger. The senior_review
-- state should no longer be assigned; existing rows with that state stay.
create or replace function public.triage_maybe_enter_senior_review(p_camp_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentional no-op post location-approval refactor. The senior_review
  -- state is no longer assigned by triggers. See LOCATION_APPROVAL_SPEC §4d.
  return;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Photo-insert: location-approval short-circuit for triage.
-- Preserves the dual-workflow behavior from migration 37 (both triage and
-- rating state are recomputed on photo insert). Adds the location-approval
-- gate to the TRIAGE path only — rating is per Decision 4 unaffected by
-- location approval. When the parent location is approved, the photo's
-- triage_state stays not_required and no triage-side week recompute fires;
-- the rating_state path runs normally so rating still happens for approved
-- locations.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_photos_after_insert_recompute_week_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_triage_role public.camp_week_triage_role;
  v_rating_role public.camp_week_triage_role;
  v_triage_state public.camp_week_triage_state;
  v_rating_state public.camp_week_rating_state;
  v_location_id uuid;
  v_triage_approved boolean;
begin
  select triage_role, rating_role, triage_state, rating_state, location_id
    into v_triage_role, v_rating_role, v_triage_state, v_rating_state, v_location_id
    from public.camp_weeks
   where id = new.camp_week_id;

  v_triage_approved := public.is_location_approved(v_location_id);

  -- Triage state assignment.
  if v_triage_approved then
    new.triage_state := 'not_required';
  elsif v_triage_role in ('first_week', 'second_week_recheck') then
    new.triage_state := 'pending';
  else
    new.triage_state := coalesce(new.triage_state, 'not_required');
  end if;

  -- Rating state assignment — independent of location approval.
  if v_rating_role in ('first_week', 'second_week_recheck', 'later_week') then
    new.rating_state := 'pending';
  else
    new.rating_state := coalesce(new.rating_state, 'not_required');
  end if;

  -- Triage week-state recompute (skipped when location is approved).
  if v_triage_role in ('first_week', 'second_week_recheck') and not v_triage_approved then
    if v_triage_state in ('not_required', 'awaiting_photos') then
      update public.camp_weeks
         set triage_state = 'photos_in'
       where id = new.camp_week_id;
    elsif v_triage_state in ('triage_done', 'senior_review', 'complete')
          and new.triage_state = 'pending' then
      update public.camp_weeks
         set triage_state = 'triage_in_progress',
             triage_done_at = null
       where id = new.camp_week_id;
    end if;
  end if;

  -- Rating week-state recompute.
  if v_rating_role in ('first_week', 'second_week_recheck', 'later_week') then
    if v_rating_state in ('not_required', 'awaiting_photos') then
      update public.camp_weeks
         set rating_state = 'photos_in'
       where id = new.camp_week_id;
    elsif v_rating_state in ('rating_done', 'complete')
          and new.rating_state = 'pending' then
      update public.camp_weeks
         set rating_state = 'rating_in_progress',
             rating_done_at = null
       where id = new.camp_week_id;
    end if;
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Claim-release: route by release_reason.
-- The 'location_approved' path sends photos to not_required (they were drained
-- by approval, not released back to the queue). Other reasons keep the
-- pre-existing pending-revert behavior.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_triage_claims_after_update_released_revert_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.released_at is null and new.released_at is not null then
    if new.release_reason = 'location_approved' then
      update public.photos
         set triage_state = 'not_required',
             triage_claim_id = null
       where triage_claim_id = new.id
         and triage_state = 'in_progress';
    else
      update public.photos
         set triage_state = 'pending',
             triage_claim_id = null
       where triage_claim_id = new.id
         and triage_state = 'in_progress';
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Claim-stamp ordering: drop sampled_for_burst, switch to newest-first.
-- Defense in depth: also exclude photos whose location is approved (in
-- practice they're already not_required, but a tight WHERE clause is robust).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_triage_claims_after_insert_stamp_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_location_id uuid;
begin
  select location_id into v_location_id
    from public.camp_weeks where id = new.camp_week_id;

  select array_agg(p.id order by p.captured_at desc nulls last, p.id desc)
    into v_ids
    from (
      select id, captured_at
        from public.photos
       where camp_week_id = new.camp_week_id
         and triage_state = 'pending'
         and not public.is_location_approved(v_location_id)
       order by captured_at desc nulls last, id desc
       limit new.slice_size
    ) p;

  if v_ids is not null and array_length(v_ids, 1) > 0 then
    update public.photos
       set triage_state = 'in_progress',
           triage_claim_id = new.id
     where id = any(v_ids);
  end if;

  update public.camp_weeks
     set triage_state = case
           when triage_state = 'photos_in' then 'triage_in_progress'::public.camp_week_triage_state
           else triage_state
         end,
         triage_started_at = coalesce(triage_started_at, now())
   where id = new.camp_week_id
     and triage_state in ('photos_in', 'triage_in_progress');

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Drain on approve.
-- Step 1 releases active claims at the location (the claim-release trigger
-- routes the in_progress photos to not_required via the 'location_approved'
-- branch). Step 2 catches the remaining pending photos that weren't held by
-- any claim. The two steps together cover both shapes.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_location_approvals_after_insert_drain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked_at is not null then
    return new;
  end if;

  -- 1. Release active claims at this location.
  update public.triage_claims c
     set released_at = now(),
         release_reason = 'location_approved'
    from public.camp_weeks cw
   where c.camp_week_id = cw.id
     and cw.location_id = new.location_id
     and c.released_at is null;

  -- 2. Drain pending photos at this location (in_progress photos are handled
  --    by the claim-release cascade above). triage_claim_id is already null
  --    on pending photos.
  update public.photos p
     set triage_state = 'not_required'
    from public.camp_weeks cw
   where p.camp_week_id = cw.id
     and cw.location_id = new.location_id
     and p.triage_state = 'pending';

  return new;
end;
$$;

create trigger tg_location_approvals_after_insert_drain
  after insert on public.location_approvals
  for each row
  execute function public.tg_location_approvals_after_insert_drain();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Reopen on revoke.
-- Flip photos at this location currently not_required back to pending — but
-- only when the parent week is triage-eligible (triage_role <> 'none'),
-- so weeks 3+ at the location stay quiet. Claims that were released with
-- 'location_approved' stay released; reviewers don't time-travel back in.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_location_approvals_after_update_revoke()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  update public.photos p
     set triage_state = 'pending'
    from public.camp_weeks cw
   where p.camp_week_id = cw.id
     and cw.location_id = new.location_id
     and p.triage_state = 'not_required'
     and cw.triage_role <> 'none';

  return new;
end;
$$;

create trigger tg_location_approvals_after_update_revoke
  after update of revoked_at on public.location_approvals
  for each row
  execute function public.tg_location_approvals_after_update_revoke();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SECURITY DEFINER RPCs for approve / revoke.
-- The location_approvals table has no client INSERT/UPDATE policies; all
-- writes go through these RPCs so the drain/reopen triggers fire under a
-- consistent identity and the auth check is uniform.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.approve_location(
  p_location_id uuid,
  p_season_start date default null,
  p_legacy_camp_week_id uuid default null
)
returns public.location_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season date;
  v_row public.location_approvals;
begin
  if not public.is_senior_or_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_season := coalesce(
    p_season_start,
    (select season_first_week_start from public.triage_config where id = 1)
  );

  insert into public.location_approvals (location_id, season_start, approved_by)
  values (p_location_id, v_season, auth.uid())
  returning * into v_row;

  -- Optional dual-write for the legacy /api/triage/signoff shim. Phase 4
  -- drops both this parameter and the camp_weeks signoff columns.
  if p_legacy_camp_week_id is not null then
    update public.camp_weeks
       set signoff_at = coalesce(signoff_at, now()),
           signoff_by = coalesce(signoff_by, auth.uid())
     where id = p_legacy_camp_week_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.approve_location(uuid, date, uuid) from public;
grant execute on function public.approve_location(uuid, date, uuid) to authenticated;

create or replace function public.revoke_location(
  p_location_id uuid,
  p_reason text default null
)
returns public.location_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.location_approvals;
  v_season date;
begin
  if not public.is_senior_or_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_season := (select season_first_week_start from public.triage_config where id = 1);

  update public.location_approvals
     set revoked_at = now(),
         revoked_by = auth.uid(),
         revocation_reason = p_reason
   where location_id = p_location_id
     and season_start = v_season
     and revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'no active approval to revoke' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.revoke_location(uuid, text) from public;
grant execute on function public.revoke_location(uuid, text) to authenticated;
