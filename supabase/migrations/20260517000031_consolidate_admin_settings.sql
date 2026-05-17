-- Consolidate admin settings: unified season dates on triage_config;
-- drop smugmug_config + smugmug_mode.

-- ─── 1. Rename triage_config season columns (idempotent) ─────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'triage_config'
      and column_name = 'first_week_window_start'
  ) then
    alter table public.triage_config
      rename column first_week_window_start to season_first_week_start;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'triage_config'
      and column_name = 'first_week_window_end'
  ) then
    alter table public.triage_config
      rename column first_week_window_end to season_last_week_start;
  end if;
end $$;

-- ─── 2. Replace derive + config-update trigger (before any triage_config UPDATE) ─

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
  cfg record;
  v_in_window boolean;
  v_is_earliest boolean;
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

  select * into cfg from public.triage_config where id = 1;
  if cfg is null then
    return 'none';
  end if;

  v_in_window := p_starts_on between cfg.season_first_week_start and cfg.season_last_week_start;
  if not v_in_window then
    return 'none';
  end if;

  select not exists (
    select 1 from public.camp_weeks cw
    where cw.location_id = p_location_id
      and cw.id <> p_camp_week_id
      and cw.starts_on between cfg.season_first_week_start and cfg.season_last_week_start
      and (cw.starts_on < p_starts_on
           or (cw.starts_on = p_starts_on and cw.id < p_camp_week_id))
  ) into v_is_earliest;

  if v_is_earliest then
    return 'first_week';
  end if;
  return 'none';
end;
$$;

drop trigger if exists tg_triage_config_after_update_recompute_all_roles on public.triage_config;

create or replace function public.tg_triage_config_after_update_recompute_all_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.camp_weeks cw
  set triage_role = public.derive_camp_week_triage_role(
    cw.location_id,
    cw.starts_on,
    cw.id,
    cw.is_first_week_override,
    cw.triage_role
  )
  where true;

  return new;
end;
$$;

create trigger tg_triage_config_after_update_recompute_all_roles
  after update of season_first_week_start, season_last_week_start
  on public.triage_config
  for each row
  execute function public.tg_triage_config_after_update_recompute_all_roles();

-- ─── 3. Backfill unified start from smugmug_config when present ────────────

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'smugmug_config'
  ) then
    update public.triage_config tc
    set season_first_week_start = least(
      tc.season_first_week_start,
      coalesce(
        (select sc.season_start_date from public.smugmug_config sc where sc.id = 1),
        tc.season_first_week_start
      ),
      coalesce(
        (select sc.earliest_fetch_date from public.smugmug_config sc where sc.id = 1),
        tc.season_first_week_start
      )
    )
    where tc.id = 1;
  end if;
end $$;

-- ─── 4. Drop smugmug_config ─────────────────────────────────────────────────

drop policy if exists smugmug_config_select_authenticated on public.smugmug_config;
drop policy if exists smugmug_config_write_admin on public.smugmug_config;
drop table if exists public.smugmug_config;
drop type if exists public.smugmug_mode;
