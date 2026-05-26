-- Week role derivation (1st / 2nd recheck / 3rd+ photo-only) and review workflow
-- promotion when photos sync or camp weeks are created.
-- Enum value `later_week` is added in 20260526000036_add_later_week_role.sql.

-- ─── 1. Season ordinal at location (1 = earliest in-season week) ─────────────

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
begin
  select * into cfg from public.triage_config where id = 1;
  if cfg is null then
    return null;
  end if;

  if p_starts_on < cfg.season_first_week_start
     or p_starts_on > cfg.season_last_week_start then
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
  );
end;
$$;

-- ─── 3. Rating role: triage weeks + week 3+ photo review only ────────────────

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
  cfg record;
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

  select * into cfg from public.triage_config where id = 1;
  if cfg is null then
    return 'none';
  end if;

  if p_starts_on < cfg.season_first_week_start
     or p_starts_on > cfg.season_last_week_start then
    return 'none';
  end if;

  v_ordinal := public.camp_week_season_ordinal(p_location_id, p_starts_on, p_camp_week_id);

  if v_ordinal = 1 then
    return 'first_week';
  end if;

  if v_ordinal >= 3 then
    return 'later_week';
  end if;

  return 'none';
end;
$$;

-- ─── 4. Workflow activation helpers ──────────────────────────────────────────

create or replace function public.camp_week_activate_triage_workflow(p_camp_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.camp_week_triage_role;
  v_state public.camp_week_triage_state;
  v_photo_count int;
begin
  select triage_role, triage_state
    into v_role, v_state
    from public.camp_weeks
   where id = p_camp_week_id;

  if v_role not in ('first_week', 'second_week_recheck') then
    return;
  end if;

  update public.photos
     set triage_state = 'pending'
   where camp_week_id = p_camp_week_id
     and triage_state = 'not_required';

  select count(*) into v_photo_count
    from public.photos
   where camp_week_id = p_camp_week_id;

  if v_state = 'not_required' then
    update public.camp_weeks
       set triage_state = case
             when v_photo_count = 0 then 'awaiting_photos'::public.camp_week_triage_state
             else 'photos_in'::public.camp_week_triage_state
           end
     where id = p_camp_week_id;
  end if;
end;
$$;

create or replace function public.camp_week_activate_rating_workflow(p_camp_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.camp_week_triage_role;
  v_state public.camp_week_rating_state;
  v_photo_count int;
begin
  select rating_role, rating_state
    into v_role, v_state
    from public.camp_weeks
   where id = p_camp_week_id;

  if v_role not in ('first_week', 'second_week_recheck', 'later_week') then
    return;
  end if;

  update public.photos
     set rating_state = 'pending'
   where camp_week_id = p_camp_week_id
     and rating_state = 'not_required';

  select count(*) into v_photo_count
    from public.photos
   where camp_week_id = p_camp_week_id;

  if v_state = 'not_required' then
    update public.camp_weeks
       set rating_state = case
             when v_photo_count = 0 then 'awaiting_photos'::public.camp_week_rating_state
             else 'photos_in'::public.camp_week_rating_state
           end
     where id = p_camp_week_id;
  end if;
end;
$$;

create or replace function public.camp_week_deactivate_triage_workflow(p_camp_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photos
     set triage_state = 'not_required',
         triage_claim_id = null
   where camp_week_id = p_camp_week_id
     and triage_state in ('pending', 'in_progress');

  update public.triage_claims
     set released_at = now(),
         release_reason = 'admin_force'
   where camp_week_id = p_camp_week_id
     and released_at is null;

  update public.camp_weeks
     set triage_state = 'not_required'
   where id = p_camp_week_id;
end;
$$;

create or replace function public.camp_week_deactivate_rating_workflow(p_camp_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photos
     set rating_state = 'not_required',
         rating_claim_id = null
   where camp_week_id = p_camp_week_id
     and rating_state in ('pending', 'in_progress');

  update public.photo_rating_claims
     set released_at = now(),
         release_reason = 'admin_force'
   where camp_week_id = p_camp_week_id
     and released_at is null;

  update public.camp_weeks
     set rating_state = 'not_required'
   where id = p_camp_week_id;
end;
$$;

-- ─── 5. Compute triage_role + rating_role on insert / date override ─────────

create or replace function public.tg_camp_weeks_compute_triage_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_triage public.camp_week_triage_role;
  v_existing_rating public.camp_week_triage_role;
begin
  v_existing_triage := case
    when tg_op = 'UPDATE' then old.triage_role
    else 'none'::public.camp_week_triage_role
  end;
  v_existing_rating := case
    when tg_op = 'UPDATE' then old.rating_role
    else 'none'::public.camp_week_triage_role
  end;

  new.triage_role := public.derive_camp_week_triage_role(
    new.location_id,
    new.starts_on,
    new.id,
    new.is_first_week_override,
    v_existing_triage
  );

  new.rating_role := public.derive_camp_week_rating_role(
    new.location_id,
    new.starts_on,
    new.id,
    new.is_first_week_override,
    new.triage_role,
    v_existing_rating
  );

  return new;
end;
$$;

-- ─── 6. Role fanout (triage and rating are independent) ───────────────────────

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
           and rating_role = 'none';
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

drop trigger if exists tg_camp_weeks_after_update_role_fanout on public.camp_weeks;

create trigger tg_camp_weeks_after_update_role_fanout
  after update of triage_role, rating_role
  on public.camp_weeks
  for each row
  execute function public.tg_camp_weeks_after_update_role_fanout();

create or replace function public.tg_camp_weeks_after_insert_activate_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.triage_role in ('first_week', 'second_week_recheck') then
    perform public.camp_week_activate_triage_workflow(new.id);
  end if;

  if new.rating_role in ('first_week', 'second_week_recheck', 'later_week') then
    perform public.camp_week_activate_rating_workflow(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists tg_camp_weeks_after_insert_activate_workflows on public.camp_weeks;

create trigger tg_camp_weeks_after_insert_activate_workflows
  after insert on public.camp_weeks
  for each row
  execute function public.tg_camp_weeks_after_insert_activate_workflows();

-- ─── 7. Config recompute sets both roles ─────────────────────────────────────

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
         );

  update public.camp_weeks cw
     set rating_role = public.derive_camp_week_rating_role(
           cw.location_id,
           cw.starts_on,
           cw.id,
           cw.is_first_week_override,
           cw.triage_role,
           cw.rating_role
         );

  return new;
end;
$$;

-- ─── 8. Photo insert promotes week workflows from not_required ───────────────

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
begin
  select triage_role, rating_role, triage_state, rating_state
    into v_triage_role, v_rating_role, v_triage_state, v_rating_state
    from public.camp_weeks
   where id = new.camp_week_id;

  if v_triage_role in ('first_week', 'second_week_recheck') then
    new.triage_state := 'pending';
  else
    new.triage_state := coalesce(new.triage_state, 'not_required');
  end if;

  if v_rating_role in ('first_week', 'second_week_recheck', 'later_week') then
    new.rating_state := 'pending';
  else
    new.rating_state := coalesce(new.rating_state, 'not_required');
  end if;

  if v_triage_role in ('first_week', 'second_week_recheck') then
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

-- ─── 9. Backfill rating roles + promote stuck review weeks ───────────────────

update public.camp_weeks cw
   set rating_role = public.derive_camp_week_rating_role(
         cw.location_id,
         cw.starts_on,
         cw.id,
         cw.is_first_week_override,
         cw.triage_role,
         cw.rating_role
       );

update public.photos p
   set rating_state = case
         when cw.rating_role = 'none' then 'not_required'::public.photo_rating_state
         when p.rating_state = 'not_required' then 'pending'::public.photo_rating_state
         else p.rating_state
       end
  from public.camp_weeks cw
 where p.camp_week_id = cw.id;

update public.photos p
   set triage_state = case
         when cw.triage_role = 'none' then 'not_required'::public.photo_triage_state
         when p.triage_state = 'not_required' then 'pending'::public.photo_triage_state
         else p.triage_state
       end
  from public.camp_weeks cw
 where p.camp_week_id = cw.id;

-- Weeks with reviewable roles but still hidden from hubs.
update public.camp_weeks cw
   set triage_state = case
         when cw.triage_role not in ('first_week', 'second_week_recheck') then cw.triage_state
         when not exists (select 1 from public.photos p where p.camp_week_id = cw.id)
           then 'awaiting_photos'::public.camp_week_triage_state
         else 'photos_in'::public.camp_week_triage_state
       end
 where cw.triage_role in ('first_week', 'second_week_recheck')
   and cw.triage_state = 'not_required';

update public.camp_weeks cw
   set rating_state = case
         when cw.rating_role = 'none' then cw.rating_state
         when not exists (select 1 from public.photos p where p.camp_week_id = cw.id)
           then 'awaiting_photos'::public.camp_week_rating_state
         else 'photos_in'::public.camp_week_rating_state
       end
 where cw.rating_role <> 'none'
   and cw.rating_state = 'not_required';
