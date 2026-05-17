-- Migration 28 — Triage triggers, RLS, backfill.
-- See spec/TRIAGE_SPEC.md §3e, §4.

-- ─── Helper: derive triage_role for one camp_week row ───────────────────────

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
  v_role public.camp_week_triage_role;
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

  v_in_window := p_starts_on between cfg.first_week_window_start and cfg.first_week_window_end;
  if not v_in_window then
    return 'none';
  end if;

  select not exists (
    select 1 from public.camp_weeks cw
    where cw.location_id = p_location_id
      and cw.id <> p_camp_week_id
      and cw.starts_on between cfg.first_week_window_start and cfg.first_week_window_end
      and (cw.starts_on < p_starts_on
           or (cw.starts_on = p_starts_on and cw.id < p_camp_week_id))
  ) into v_is_earliest;

  if v_is_earliest then
    return 'first_week';
  end if;
  return 'none';
end;
$$;

-- ─── 4a. Role derivation on camp_weeks ───────────────────────────────────────

create or replace function public.tg_camp_weeks_compute_triage_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.triage_role := public.derive_camp_week_triage_role(
    new.location_id,
    new.starts_on,
    new.id,
    new.is_first_week_override,
    case when tg_op = 'UPDATE' then old.triage_role else 'none'::public.camp_week_triage_role end
  );
  return new;
end;
$$;

create trigger tg_camp_weeks_compute_triage_role
  before insert or update of starts_on, is_first_week_override
  on public.camp_weeks
  for each row
  execute function public.tg_camp_weeks_compute_triage_role();

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
  return new;
end;
$$;

create trigger tg_triage_config_after_update_recompute_all_roles
  after update of first_week_window_start, first_week_window_end
  on public.triage_config
  for each row
  execute function public.tg_triage_config_after_update_recompute_all_roles();

-- ─── 4b. Role-change fanout ──────────────────────────────────────────────────

create or replace function public.tg_camp_weeks_after_update_role_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo_count int;
begin
  if old.triage_role is not distinct from new.triage_role then
    return new;
  end if;

  if new.triage_role in ('first_week', 'second_week_recheck')
     and old.triage_role = 'none' then
    update public.photos
       set triage_state = 'pending'
     where camp_week_id = new.id
       and triage_state = 'not_required';

    select count(*) into v_photo_count from public.photos where camp_week_id = new.id;

    update public.camp_weeks
       set triage_state = case
             when v_photo_count = 0 then 'awaiting_photos'::public.camp_week_triage_state
             else 'photos_in'::public.camp_week_triage_state
           end
     where id = new.id;
    return new;
  end if;

  if new.triage_role = 'none'
     and old.triage_role in ('first_week', 'second_week_recheck') then
    update public.photos
       set triage_state = 'not_required',
           triage_claim_id = null
     where camp_week_id = new.id
       and triage_state in ('pending', 'in_progress');

    update public.triage_claims
       set released_at = now(),
           release_reason = 'admin_force'
     where camp_week_id = new.id
       and released_at is null;

    update public.camp_weeks
       set triage_state = 'not_required'
     where id = new.id;
    return new;
  end if;

  return new;
end;
$$;

create trigger tg_camp_weeks_after_update_role_fanout
  after update of triage_role
  on public.camp_weeks
  for each row
  execute function public.tg_camp_weeks_after_update_role_fanout();

-- ─── Shared: maybe enter senior_review ───────────────────────────────────────

create or replace function public.triage_maybe_enter_senior_review(p_camp_week_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.camp_weeks
     set triage_state = 'senior_review',
         senior_review_started_at = coalesce(senior_review_started_at, now())
   where id = p_camp_week_id
     and triage_state = 'triage_done';
end;
$$;

-- ─── 4c. Photo insert/update → week state ───────────────────────────────────

create or replace function public.tg_photos_after_insert_recompute_week_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.camp_week_triage_role;
  v_week_state public.camp_week_triage_state;
begin
  select triage_role, triage_state into v_role, v_week_state
    from public.camp_weeks where id = new.camp_week_id;

  if v_role <> 'none' then
    new.triage_state := 'pending';
  else
    new.triage_state := coalesce(new.triage_state, 'not_required');
  end if;

  if v_week_state = 'awaiting_photos' then
    update public.camp_weeks
       set triage_state = 'photos_in'
     where id = new.camp_week_id;
  elsif v_week_state in ('triage_done', 'senior_review', 'complete') and new.triage_state = 'pending' then
    update public.camp_weeks
       set triage_state = 'triage_in_progress',
           triage_done_at = null
     where id = new.camp_week_id;
  end if;

  return new;
end;
$$;

create trigger tg_photos_after_insert_recompute_week_state
  before insert on public.photos
  for each row
  execute function public.tg_photos_after_insert_recompute_week_state();

create or replace function public.tg_photos_after_update_state_recompute_week_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int;
  v_week_state public.camp_week_triage_state;
begin
  if old.triage_state is not distinct from new.triage_state then
    return new;
  end if;

  select triage_state into v_week_state from public.camp_weeks where id = new.camp_week_id;

  select count(*) into v_active
    from public.photos
   where camp_week_id = new.camp_week_id
     and triage_state in ('pending', 'in_progress');

  if v_active = 0 and v_week_state = 'triage_in_progress' then
    update public.camp_weeks
       set triage_state = 'triage_done',
           triage_done_at = coalesce(triage_done_at, now())
     where id = new.camp_week_id;
  elsif v_active > 0 and v_week_state = 'triage_done' then
    update public.camp_weeks
       set triage_state = 'triage_in_progress',
           triage_done_at = null
     where id = new.camp_week_id;
  end if;

  return new;
end;
$$;

create trigger tg_photos_after_update_state_recompute_week_state
  after update of triage_state on public.photos
  for each row
  execute function public.tg_photos_after_update_state_recompute_week_state();

-- ─── 4d. Claims ──────────────────────────────────────────────────────────────

create or replace function public.tg_triage_claims_after_insert_stamp_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(p.id order by p.sampled_for_burst desc, p.captured_at asc nulls last, p.id asc)
    into v_ids
    from (
      select id, sampled_for_burst, captured_at
        from public.photos
       where camp_week_id = new.camp_week_id
         and triage_state = 'pending'
       order by sampled_for_burst desc, captured_at asc nulls last, id asc
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

create trigger tg_triage_claims_after_insert_stamp_photos
  after insert on public.triage_claims
  for each row
  execute function public.tg_triage_claims_after_insert_stamp_photos();

create or replace function public.tg_triage_claims_after_update_released_revert_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.released_at is null and new.released_at is not null then
    update public.photos
       set triage_state = 'pending',
           triage_claim_id = null
     where triage_claim_id = new.id
       and triage_state = 'in_progress';
  end if;
  return new;
end;
$$;

create trigger tg_triage_claims_after_update_released_revert_photos
  after update of released_at on public.triage_claims
  for each row
  execute function public.tg_triage_claims_after_update_released_revert_photos();

-- ─── 4e. Triage events ───────────────────────────────────────────────────────

create or replace function public.tg_triage_events_after_insert_apply_to_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp_week_id uuid;
begin
  select camp_week_id into v_camp_week_id from public.photos where id = new.photo_id;

  case new.kind
    when 'clean' then
      update public.photos
         set triage_state = 'clean',
             triage_claim_id = case
               when triage_claim_id = new.claim_id and triage_state = 'in_progress' then null
               else triage_claim_id
             end
       where id = new.photo_id;
    when 'flag' then
      update public.photos
         set triage_state = 'flagged',
             is_quarantined = new.quarantine_intent or is_quarantined,
             triage_claim_id = case
               when triage_claim_id = new.claim_id and triage_state = 'in_progress' then null
               else triage_claim_id
             end
       where id = new.photo_id;
    when 'senior_delete' then
      update public.photos set triage_state = 'deleted' where id = new.photo_id;
      perform public.triage_maybe_enter_senior_review(v_camp_week_id);
    when 'senior_quarantine' then
      update public.photos set is_quarantined = true where id = new.photo_id;
      perform public.triage_maybe_enter_senior_review(v_camp_week_id);
    when 'senior_release_quarantine' then
      update public.photos set is_quarantined = false where id = new.photo_id;
      perform public.triage_maybe_enter_senior_review(v_camp_week_id);
    else
      null;
  end case;

  return new;
end;
$$;

create trigger tg_triage_events_after_insert_apply_to_photo
  after insert on public.triage_events
  for each row
  execute function public.tg_triage_events_after_insert_apply_to_photo();

create or replace function public.tg_triage_events_after_insert_bump_claim_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.claim_id is not null then
    update public.triage_claims
       set last_activity_at = now()
     where id = new.claim_id
       and released_at is null;
  end if;
  return new;
end;
$$;

create trigger tg_triage_events_after_insert_bump_claim_activity
  after insert on public.triage_events
  for each row
  execute function public.tg_triage_events_after_insert_bump_claim_activity();

create or replace function public.tg_triage_events_after_insert_bump_last_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_active_at = now()
   where id = new.reviewer_id;
  return new;
end;
$$;

create trigger tg_triage_events_after_insert_bump_last_active
  after insert on public.triage_events
  for each row
  execute function public.tg_triage_events_after_insert_bump_last_active();

-- ─── 4f. Senior touch + signoff ───────────────────────────────────────────────

create or replace function public.tg_camp_weeks_after_update_first_senior_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.triage_state is distinct from old.triage_state then
    return new;
  end if;

  if old.triage_state <> 'triage_done' then
    return new;
  end if;

  if (new.positive_great_quality is distinct from old.positive_great_quality and new.positive_great_quality)
     or (new.positive_great_variety is distinct from old.positive_great_variety and new.positive_great_variety)
     or (new.positive_shininess_great is distinct from old.positive_shininess_great and new.positive_shininess_great)
  then
    new.triage_state := 'senior_review';
    new.senior_review_started_at := coalesce(new.senior_review_started_at, now());
  end if;

  return new;
end;
$$;

create trigger tg_camp_weeks_after_update_first_senior_touch
  before update of positive_great_quality, positive_great_variety, positive_shininess_great
  on public.camp_weeks
  for each row
  execute function public.tg_camp_weeks_after_update_first_senior_touch();

create or replace function public.tg_camp_weeks_after_update_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sibling_id uuid;
  v_sibling_role public.camp_week_triage_role;
begin
  if old.signoff_at is not null or new.signoff_at is null then
    return new;
  end if;

  new.triage_state := 'complete';

  if new.triage_role = 'first_week' and new.recheck_flagged_at is not null then
    select cw.id, cw.triage_role into v_sibling_id, v_sibling_role
      from public.camp_weeks cw
     where cw.location_id = new.location_id
       and cw.starts_on > new.starts_on
     order by cw.starts_on asc, cw.id asc
     limit 1;

    if v_sibling_id is null then
      raise exception 'No 2nd week found for recheck at location %', new.location_id;
    end if;

    if v_sibling_role not in ('none', 'second_week_recheck') then
      raise exception 'Sibling week % has conflicting triage_role %', v_sibling_id, v_sibling_role;
    end if;

    if v_sibling_role = 'none' then
      update public.camp_weeks
         set triage_role = 'second_week_recheck'
       where id = v_sibling_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger tg_camp_weeks_after_update_signoff
  before update of signoff_at on public.camp_weeks
  for each row
  execute function public.tg_camp_weeks_after_update_signoff();

-- ─── 4g. Claim sweeper ───────────────────────────────────────────────────────

create or replace function public.triage_claims_expire_inactive()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with expired as (
    update public.triage_claims
       set released_at = now(),
           release_reason = 'auto_expired'
     where released_at is null
       and last_activity_at < now() - make_interval(
         mins => (select claim_expiry_minutes from public.triage_config where id = 1)
       )
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.triage_claims_expire_inactive() from public;
grant execute on function public.triage_claims_expire_inactive() to service_role;

-- ─── Signoff RPC (Q3) ────────────────────────────────────────────────────────

create or replace function public.triage_signoff_camp_week(
  p_camp_week_id uuid,
  p_flag_second_week_recheck boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_senior_or_admin() then
    raise exception 'not authorized';
  end if;

  update public.camp_weeks
     set signoff_at = now(),
         signoff_by = auth.uid(),
         recheck_flagged_at = case when p_flag_second_week_recheck then now() else recheck_flagged_at end,
         recheck_flagged_by = case when p_flag_second_week_recheck then auth.uid() else recheck_flagged_by end
   where id = p_camp_week_id
     and triage_state in ('triage_done', 'senior_review')
     and signoff_at is null;

  if not found then
    raise exception 'camp week not eligible for signoff';
  end if;
end;
$$;

revoke all on function public.triage_signoff_camp_week(uuid, boolean) from public;
grant execute on function public.triage_signoff_camp_week(uuid, boolean) to authenticated;

create or replace function public.triage_set_positive_assessment(
  p_camp_week_id uuid,
  p_great_quality boolean,
  p_great_variety boolean,
  p_shininess_great boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_senior_or_admin() then
    raise exception 'not authorized';
  end if;

  update public.camp_weeks
     set positive_great_quality = p_great_quality,
         positive_great_variety = p_great_variety,
         positive_shininess_great = p_shininess_great
   where id = p_camp_week_id;
end;
$$;

revoke all on function public.triage_set_positive_assessment(uuid, boolean, boolean, boolean) from public;
grant execute on function public.triage_set_positive_assessment(uuid, boolean, boolean, boolean) to authenticated;

create or replace function public.triage_reset_sample_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with updated as (
    update public.photos
       set sampled_for_burst = false
     where triage_state in ('pending', 'in_progress')
       and sampled_for_burst = true
    returning id
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

revoke all on function public.triage_reset_sample_flags() from public;
grant execute on function public.triage_reset_sample_flags() to authenticated;

-- ─── RLS (§3e) ───────────────────────────────────────────────────────────────

alter table public.triage_config enable row level security;
alter table public.triage_claims enable row level security;
alter table public.triage_events enable row level security;
alter table public.triage_event_tags enable row level security;

create policy triage_config_select_authenticated
  on public.triage_config for select to authenticated using (true);

create policy triage_config_write_admin
  on public.triage_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy triage_claims_select_authenticated
  on public.triage_claims for select to authenticated using (true);

create policy triage_claims_insert_reviewer
  on public.triage_claims for insert to authenticated
  with check (reviewer_id = auth.uid());

create policy triage_claims_update_owner_or_admin
  on public.triage_claims for update to authenticated
  using (reviewer_id = auth.uid() or public.is_admin())
  with check (reviewer_id = auth.uid() or public.is_admin());

create policy triage_claims_delete_admin
  on public.triage_claims for delete to authenticated
  using (public.is_admin());

create policy triage_events_select_authenticated
  on public.triage_events for select to authenticated using (true);

create policy triage_events_insert_reviewer
  on public.triage_events for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and kind in ('clean', 'flag')
  );

create policy triage_events_insert_senior
  on public.triage_events for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and public.is_senior_or_admin()
    and kind in ('senior_delete', 'senior_quarantine', 'senior_release_quarantine')
  );

create policy triage_event_tags_select_authenticated
  on public.triage_event_tags for select to authenticated using (true);

create policy triage_event_tags_insert_owner
  on public.triage_event_tags for insert to authenticated
  with check (
    exists (
      select 1 from public.triage_events e
      where e.id = event_id
        and e.reviewer_id = auth.uid()
        and e.kind = 'flag'
    )
  );

create policy locations_update_admin
  on public.locations for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy camp_weeks_update_admin_override
  on public.camp_weeks for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── Backfill ────────────────────────────────────────────────────────────────

update public.camp_weeks cw
set triage_role = public.derive_camp_week_triage_role(
  cw.location_id,
  cw.starts_on,
  cw.id,
  cw.is_first_week_override,
  cw.triage_role
);

update public.photos p
set triage_state = case
  when cw.triage_role = 'none' then 'not_required'::public.photo_triage_state
  when p.triage_state = 'not_required' then 'pending'::public.photo_triage_state
  else p.triage_state
end
from public.camp_weeks cw
where p.camp_week_id = cw.id;

update public.camp_weeks cw
set triage_state = case
  when cw.triage_role = 'none' then 'not_required'::public.camp_week_triage_state
  when not exists (select 1 from public.photos p where p.camp_week_id = cw.id) then 'awaiting_photos'::public.camp_week_triage_state
  when exists (
    select 1 from public.photos p
    where p.camp_week_id = cw.id
      and p.triage_state in ('pending', 'in_progress')
  ) then 'triage_in_progress'::public.camp_week_triage_state
  when exists (
    select 1 from public.photos p
    where p.camp_week_id = cw.id
      and p.triage_state not in ('not_required', 'clean', 'flagged', 'deleted')
  ) then 'photos_in'::public.camp_week_triage_state
  when exists (select 1 from public.photos p where p.camp_week_id = cw.id) then 'photos_in'::public.camp_week_triage_state
  else 'awaiting_photos'::public.camp_week_triage_state
end
where cw.triage_role <> 'none';
