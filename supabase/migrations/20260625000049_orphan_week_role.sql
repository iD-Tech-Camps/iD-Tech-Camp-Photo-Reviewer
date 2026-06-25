-- Orphaned-week handling for season role derivation.
--
-- Problem: the quality-review hub surfaces each location's earliest in-window
-- week (triage first_week). `camp_week_season_ordinal` chose that week purely
-- by date, ignoring whether the week ever received photos. When someone created
-- a SmugMug folder for a week camp never actually ran (a common mistake — they
-- guessed the wrong start week), that empty week kept the first_week slot
-- forever: it showed as "Upcoming" with no photos while the real weeks fell to
-- role 'none' and dropped off the hub.
--
-- Fix (per the agreed sync behavior):
--   * A week is "orphaned" once it has fully passed (ends_on < current_date)
--     AND — after we've attempted to sync it — still holds no photos. An
--     orphaned week is not a real season week: it gets no ordinal, so it can't
--     be first_week, and it isn't counted when numbering the weeks that follow.
--   * The next earliest week that actually has photos (or is still upcoming)
--     becomes first_week. A lead would never have approved the empty phantom,
--     so promoting the real week is always safe.
--
-- Because orphan status depends on current_date and photo presence — both of
-- which change without a starts_on edit — roles are recomputed at the end of
-- every photo sync via recompute_all_triage_roles(). This migration also runs
-- that recompute once so existing data heals on apply.
--
-- Note: at BEFORE INSERT the row isn't in camp_weeks yet, so the self
-- orphan-check is skipped and a freshly-discovered week still gets its
-- positional role; the post-sync recompute then demotes it if it stays empty
-- past its end date. This keeps folder discovery simple and idempotent.

-- ─── 1. Ordinal now skips orphaned (passed + empty) weeks ─────────────────────

create or replace function public.camp_week_season_ordinal(
  p_location_id uuid,
  p_starts_on date,
  p_camp_week_id uuid
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg record;
  v_ends date;
begin
  select * into cfg from public.triage_config where id = 1;
  if cfg is null then
    return null;
  end if;

  if p_starts_on < cfg.season_first_week_start
     or p_starts_on > cfg.season_last_week_start then
    return null;
  end if;

  -- This week itself: if it has fully passed and (after a sync attempt) still
  -- has no photos, it's an orphan — no ordinal, so it can't hold first_week.
  -- During BEFORE INSERT the row isn't visible yet (v_ends is NULL) so the
  -- check is skipped; the post-sync recompute settles it once the row exists.
  select ends_on into v_ends from public.camp_weeks where id = p_camp_week_id;
  if v_ends is not null
     and v_ends < current_date
     and not exists (select 1 from public.photos p where p.camp_week_id = p_camp_week_id) then
    return null;
  end if;

  return (
    select count(*)::int + 1
      from public.camp_weeks cw
     where cw.location_id = p_location_id
       and cw.id <> p_camp_week_id
       and cw.starts_on between cfg.season_first_week_start and cfg.season_last_week_start
       and (cw.starts_on < p_starts_on
            or (cw.starts_on = p_starts_on and cw.id < p_camp_week_id))
       -- Count only earlier weeks that are themselves eligible: still upcoming
       -- (not yet passed) or already holding photos. Orphaned earlier weeks
       -- don't shift the numbering of the weeks that follow them.
       and (cw.ends_on >= current_date
            or exists (select 1 from public.photos p where p.camp_week_id = cw.id))
  );
end;
$$;

-- ─── 2. Triage role derivation routes through the ordinal ─────────────────────
-- Behaviorally identical to the previous "is this the earliest in-window week?"
-- check when no orphans exist; with orphans, the earliest *eligible* week wins.

create or replace function public.derive_camp_week_triage_role(
  p_location_id uuid,
  p_starts_on date,
  p_camp_week_id uuid,
  p_is_first_week_override boolean,
  p_existing_role public.camp_week_triage_role
)
returns public.camp_week_triage_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ordinal int;
begin
  if p_is_first_week_override is true then
    return 'first_week';
  end if;
  if p_is_first_week_override is false then
    return 'none';
  end if;

  if p_existing_role = 'second_week_recheck' then
    return 'second_week_recheck';
  end if;

  v_ordinal := public.camp_week_season_ordinal(p_location_id, p_starts_on, p_camp_week_id);
  if v_ordinal = 1 then
    return 'first_week';
  end if;
  return 'none';
end;
$$;

-- ─── 3. Recompute RPC the photo sync calls after each run ─────────────────────
-- Re-derives both roles for every camp week and lets the existing role-fanout
-- trigger activate/deactivate workflows. Only rows whose role actually changes
-- are written, so settled (incl. approved) locations stay untouched and don't
-- have their photos re-flipped.

create or replace function public.recompute_all_triage_roles()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.camp_weeks cw
     set triage_role = nr.role
    from (
      select id,
             public.derive_camp_week_triage_role(
               location_id, starts_on, id, is_first_week_override, triage_role
             ) as role
        from public.camp_weeks
    ) nr
   where cw.id = nr.id
     and cw.triage_role is distinct from nr.role;

  update public.camp_weeks cw
     set rating_role = nr.role
    from (
      select id,
             public.derive_camp_week_rating_role(
               location_id, starts_on, id, is_first_week_override, triage_role, rating_role
             ) as role
        from public.camp_weeks
    ) nr
   where cw.id = nr.id
     and cw.rating_role is distinct from nr.role;
end;
$$;

revoke all on function public.recompute_all_triage_roles() from public, anon, authenticated;

-- ─── 4. Heal existing data on apply ───────────────────────────────────────────
select public.recompute_all_triage_roles();
