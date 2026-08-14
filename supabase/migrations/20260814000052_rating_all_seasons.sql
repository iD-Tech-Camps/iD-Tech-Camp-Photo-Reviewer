-- Open Camp Photo Review (star rating) to every season, not just the one
-- currently configured in triage_config.
--
-- Problem
-- -------
-- derive_camp_week_rating_role() hard-returned 'none' for any week starting
-- outside [season_first_week_start, season_last_week_start], so every week from
-- a prior season — plus every week *after* the season end, which the SmugMug
-- sync still pulls because its scope query has a lower bound only — left its
-- photos at rating_state = 'not_required'. Nothing surfaces those photos and
-- nothing can rate them: the claim pool only draws from 'pending'. On prod that
-- is ~11,700 photos of usable marketing material that can never reach the
-- Photo Library.
--
-- Quality review (triage) is deliberately NOT widened. Re-reviewing the lab
-- setup of a camp week from two years ago has no value, so
-- derive_camp_week_triage_role() and camp_week_season_ordinal() are untouched
-- and stay bound to the configured season.
--
-- Model
-- -----
-- A rating "season" is the calendar year the week starts in. That needs no new
-- schema and matches how camp actually runs. Rating therefore gets its own
-- ordinal function rather than reusing the season-bounded one — dropping the
-- window check from the role function alone would leave every out-of-season
-- week with a NULL ordinal and still derive 'none'.
--
-- Current-season safety
-- ---------------------
-- For the year that holds season_first_week_start, the lower bound stays the
-- configured start rather than Jan 1. Ordinals count *earlier* weeks, so
-- keeping that bound means no week in the season currently under review can
-- change role when this migration lands. Widening the upper bound to year-end
-- is safe for the same reason: later weeks never affect an earlier week's
-- ordinal. Weeks in the current year but before season_first_week_start keep
-- deriving 'none', exactly as they do today.
--
-- Backfill
-- --------
-- recompute_all_triage_roles() writes only rows whose role actually changes,
-- and tg_camp_weeks_after_update_role_fanout then calls
-- camp_week_activate_rating_workflow() for each week whose rating_role leaves
-- 'none'. That flips its photos not_required → pending and promotes the week's
-- rating_state, so no hand-written backfill is needed here.

-- ─── 1. Rating ordinal — calendar-year seasons ───────────────────────────────

create or replace function public.camp_week_rating_ordinal(
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
  cfg    record;
  v_year int;
  v_lower date;
  v_upper date;
  v_ends date;
begin
  select * into cfg from public.triage_config where id = 1;
  if cfg is null then
    return null;
  end if;

  v_year := extract(year from p_starts_on)::int;

  -- See "Current-season safety" above: the configured start wins for its own
  -- year so live ordinals can't shift; every other year is the plain calendar
  -- year. The ceiling is always year-end, which is what lets post-season weeks
  -- become rateable instead of stranding at 'not_required'.
  if v_year = extract(year from cfg.season_first_week_start)::int then
    v_lower := cfg.season_first_week_start;
  else
    v_lower := make_date(v_year, 1, 1);
  end if;
  v_upper := make_date(v_year, 12, 31);

  if p_starts_on < v_lower or p_starts_on > v_upper then
    return null;
  end if;

  -- Orphan rule, identical to camp_week_season_ordinal (migration 49): a week
  -- that has fully passed while still holding no photos never actually ran, so
  -- it gets no ordinal and can't hold the first_week slot. At BEFORE INSERT the
  -- row isn't visible yet (v_ends is NULL) so the check is skipped, and the
  -- post-sync recompute settles it.
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
       and cw.starts_on between v_lower and v_upper
       and (cw.starts_on < p_starts_on
            or (cw.starts_on = p_starts_on and cw.id < p_camp_week_id))
       -- Only earlier weeks that are themselves eligible count, so an orphan
       -- doesn't shift the numbering of the weeks after it. For a past season
       -- every week has ended, which reduces this to "held photos".
       and (cw.ends_on >= current_date
            or exists (select 1 from public.photos p where p.camp_week_id = cw.id))
  );
end;
$$;

-- ─── 2. Rating role derivation routes through the new ordinal ────────────────
-- Unchanged from migration 37 except that the season-window early return is
-- gone and the ordinal call is the rating one. The override / recheck
-- short-circuits and the 1 → first_week, 3+ → later_week mapping (ordinal 2 is
-- the recheck slot, owned by triage) are preserved exactly.

create or replace function public.derive_camp_week_rating_role(
  p_location_id uuid,
  p_starts_on date,
  p_camp_week_id uuid,
  p_is_first_week_override boolean,
  p_triage_role public.camp_week_triage_role,
  p_existing_rating_role public.camp_week_triage_role
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

  if p_triage_role = 'second_week_recheck' then
    return 'second_week_recheck';
  end if;

  if p_existing_rating_role = 'second_week_recheck'
     and p_triage_role = 'second_week_recheck' then
    return 'second_week_recheck';
  end if;

  v_ordinal := public.camp_week_rating_ordinal(p_location_id, p_starts_on, p_camp_week_id);

  if v_ordinal = 1 then
    return 'first_week';
  end if;

  if v_ordinal >= 3 then
    return 'later_week';
  end if;

  return 'none';
end;
$$;

-- ─── 3. Backfill via the existing recompute + fanout path ────────────────────

select public.recompute_all_triage_roles();
