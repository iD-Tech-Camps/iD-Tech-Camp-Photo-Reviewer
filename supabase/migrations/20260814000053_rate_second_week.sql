-- Make week 2 at a location rateable.
--
-- Problem
-- -------
-- derive_camp_week_rating_role() mapped ordinal 1 → first_week and ordinal 3+ →
-- later_week, leaving ordinal 2 to return 'none' unless triage had flagged that
-- week second_week_recheck. Weeks 1 and 3+ were rateable; week 2 was not. On
-- prod that stranded ~11,100 photos across 75 weeks at rating_state
-- 'not_required' — the single largest block of unreachable photos, and the real
-- reason opening past seasons (migration 52) barely moved the number.
--
-- PHOTO_RATING_SPEC described later_week as "week 3+ ... mirror triage", which
-- documents the shape but never claimed week-2 photos are unwanted. The gap
-- looks inherited from mirroring triage's structure, where week 2 genuinely is
-- the recheck slot, rather than a decision about photo value. Marketing has no
-- reason to skip a location's second week.
--
-- Change
-- ------
-- Ordinal 2 now derives later_week. The second_week_recheck short-circuit still
-- takes precedence, so a week a lead has flagged for recheck keeps that role.
-- Triage is untouched: week 2's triage_role stays 'none' unless flagged, so no
-- quality-review work is created.

-- ─── 1. Ordinal 2 becomes a rateable later week ──────────────────────────────
-- Identical to migration 52 apart from the `>= 3` → `>= 2` threshold. A NULL
-- ordinal (out of season, or an orphaned week) still falls through to 'none',
-- because a NULL comparison is not true.

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

  if v_ordinal >= 2 then
    return 'later_week';
  end if;

  return 'none';
end;
$$;

-- ─── 2. Keep the recheck label correct on a week that is now later_week ──────
-- Unchanged from migration 37 except the guard marked below. That guard read
-- `rating_role = 'none'`, which was written when ordinal 2 always derived
-- 'none'. Now that week 2 is later_week, the guard would never match and a week
-- flagged for recheck would keep reading "Week 2+" on the hub until the next
-- post-sync recompute relabelled it. Both roles are rateable, so this only ever
-- affected the label — but the label is what tells a lead the recheck landed.

create or replace function public.tg_camp_weeks_after_update_role_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.triage_role is distinct from new.triage_role then
    if new.triage_role in ('first_week', 'second_week_recheck')
       and old.triage_role = 'none' then
      if new.triage_role = 'second_week_recheck' then
        update public.camp_weeks
           set rating_role = 'second_week_recheck'
         where id = new.id
           -- was: rating_role = 'none'
           and rating_role is distinct from 'second_week_recheck';
      end if;
      perform public.camp_week_activate_triage_workflow(new.id);
      if new.triage_role = 'second_week_recheck' then
        perform public.camp_week_activate_rating_workflow(new.id);
      end if;
    elsif new.triage_role = 'none'
          and old.triage_role in ('first_week', 'second_week_recheck') then
      perform public.camp_week_deactivate_triage_workflow(new.id);
    end if;
  end if;

  if old.rating_role is distinct from new.rating_role then
    if new.rating_role in ('first_week', 'second_week_recheck', 'later_week')
       and old.rating_role = 'none' then
      perform public.camp_week_activate_rating_workflow(new.id);
    elsif new.rating_role = 'none'
          and old.rating_role in ('first_week', 'second_week_recheck', 'later_week') then
      perform public.camp_week_deactivate_rating_workflow(new.id);
    end if;
  end if;

  return new;
end;
$$;

-- The nested rating_role write above re-fires this trigger once. That pass sees
-- old.triage_role = new.triage_role (so the triage branch is skipped) and
-- old.rating_role = 'later_week' (so the rating branch takes neither arm), and
-- the guard no longer matches, so it terminates rather than recursing.

-- ─── 3. Backfill via the existing recompute + fanout path ────────────────────

select public.recompute_all_triage_roles();
