-- Location approval — Phase 4 (cleanup).
-- See spec/LOCATION_APPROVAL_SPEC.md §7 (migration ordering) and the spec's
-- per-phase notes marking the sample-burst machinery and the transition shims
-- for removal once phase 3 has soaked.
--
-- Phase 3 has soaked since 2026-05-27 with no behavioral regressions. This
-- migration retires what the new location-approval model made dead:
--   1. The Tuesday sample-burst sampler — there is no longer a queue to sample;
--      every photo at an unapproved location is in scope. Drop the
--      `photos.sampled_for_burst` column, its pending-pool index, the
--      sample-burst config columns, and the `triage_reset_sample_flags` RPC.
--   2. The dual-write shim params that bridged the legacy signoff flow:
--      `approve_location.p_legacy_camp_week_id` and
--      `triage_signoff_camp_week.p_flag_second_week_recheck`.
--
-- NOTE: the `triage_signoff_camp_week` RPC and `camp_weeks.signoff_at` /
-- `signoff_by` columns are intentionally KEPT — phase 3 repurposed them as the
-- live per-week "Mark week as reviewed" audit marker (decoupled from
-- location-level approval). They are no longer a shim.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Drop the sample-burst sampler surface.
-- ─────────────────────────────────────────────────────────────────────────────

-- The pending-pool index leads with `sampled_for_burst`; the claim-stamp
-- trigger (migration 43) now orders pending photos newest-first, so replace it
-- with an index that serves that access path.
drop index if exists public.photos_triage_pending_pool_idx;

create index if not exists photos_triage_pending_pool_idx
  on public.photos (camp_week_id, captured_at desc, id desc)
  where triage_state = 'pending';

alter table public.photos
  drop column if exists sampled_for_burst;

alter table public.triage_config
  drop column if exists max_for_triage_per_burst,
  drop column if exists sample_burst_dow,
  drop column if exists sample_burst_hour;

drop function if exists public.triage_reset_sample_flags();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop the dual-write shim parameters.
-- The signature changes, so DROP then recreate (create-or-replace can't alter
-- an argument list).
-- ─────────────────────────────────────────────────────────────────────────────

-- approve_location: remove the legacy camp_weeks signoff dual-write. Nothing
-- has called it with p_legacy_camp_week_id since the UI moved to explicit
-- location-level approve.
drop function if exists public.approve_location(uuid, date, uuid);

create or replace function public.approve_location(
  p_location_id uuid,
  p_season_start date default null
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

  return v_row;
end;
$$;

revoke all on function public.approve_location(uuid, date) from public;
grant execute on function public.approve_location(uuid, date) to authenticated;

-- triage_signoff_camp_week: the per-week review marker. Drop the dead
-- p_flag_second_week_recheck param (the recheck side effect was retired in
-- migration 43). The audit-marker behavior is unchanged.
drop function if exists public.triage_signoff_camp_week(uuid, boolean);

create or replace function public.triage_signoff_camp_week(
  p_camp_week_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_senior_or_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.camp_weeks
     set signoff_at = coalesce(signoff_at, now()),
         signoff_by = coalesce(signoff_by, auth.uid())
   where id = p_camp_week_id;

  if not found then
    raise exception 'camp week not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.triage_signoff_camp_week(uuid) from public;
grant execute on function public.triage_signoff_camp_week(uuid) to authenticated;
