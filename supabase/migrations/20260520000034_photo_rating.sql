-- Photo rating workflow (Camp Photo Review) — parallel to triage.
-- See spec/PHOTO_RATING_SPEC.md

-- ─── 1. Enums ────────────────────────────────────────────────────────────────

create type public.photo_rating_state as enum (
  'not_required', 'pending', 'in_progress', 'rated'
);

create type public.camp_week_rating_state as enum (
  'not_required', 'awaiting_photos', 'photos_in',
  'rating_in_progress', 'rating_done', 'complete'
);

create type public.tag_purpose as enum (
  'quality_flag', 'photo_rating', 'week_senior'
);

-- ─── 2. Tags purposes ───────────────────────────────────────────────────────

alter table public.tags
  add column purposes public.tag_purpose[] not null default '{quality_flag}'::public.tag_purpose[];

update public.tags set purposes = '{quality_flag}'::public.tag_purpose[];

update public.tags
   set purposes = array['quality_flag', 'photo_rating', 'week_senior']::public.tag_purpose[]
 where id in ('blurry-photos', 'duplicate-photos', 'low-lighting');

update public.tags
   set purposes = array['quality_flag', 'week_senior']::public.tag_purpose[]
 where id = 'lacking-variety';

insert into public.tags (id, label, display_order, active, category, purposes) values
  ('great-quality-week', 'Great Quality', 100, true, 'quality', '{week_senior}'),
  ('great-variety-week', 'Great Variety', 101, true, 'quality', '{week_senior}')
on conflict (id) do update set
  purposes = excluded.purposes,
  label = excluded.label,
  active = excluded.active;

-- ─── 3. camp_weeks + photos columns ─────────────────────────────────────────

alter table public.camp_weeks
  add column rating_role public.camp_week_triage_role not null default 'none',
  add column rating_state public.camp_week_rating_state not null default 'not_required',
  add column rating_started_at timestamptz,
  add column rating_done_at timestamptz;

alter table public.photos
  add column rating_state public.photo_rating_state not null default 'not_required';

-- ─── 4. Tables ───────────────────────────────────────────────────────────────

create table public.photo_rating_claims (
  id                  uuid primary key default gen_random_uuid(),
  camp_week_id        uuid not null references public.camp_weeks(id) on delete cascade,
  reviewer_id         uuid not null references public.profiles(id) on delete cascade,
  slice_size          int not null check (slice_size > 0),
  claimed_at          timestamptz not null default now(),
  last_activity_at    timestamptz not null default now(),
  released_at         timestamptz,
  release_reason      public.claim_release_reason,
  check ((released_at is null) = (release_reason is null))
);

create index photo_rating_claims_active_per_week_idx
  on public.photo_rating_claims (camp_week_id) where released_at is null;

create index photo_rating_claims_active_per_reviewer_idx
  on public.photo_rating_claims (reviewer_id) where released_at is null;

create index photo_rating_claims_sweeper_idx
  on public.photo_rating_claims (last_activity_at) where released_at is null;

create table public.photo_rating_events (
  id                uuid primary key default gen_random_uuid(),
  photo_id          uuid not null references public.photos(id) on delete cascade,
  reviewer_id       uuid not null references public.profiles(id) on delete restrict,
  claim_id          uuid references public.photo_rating_claims(id) on delete set null,
  rating            smallint not null check (rating between 1 and 5),
  quarantine_intent boolean not null default false,
  note              text,
  created_at        timestamptz not null default now()
);

create index photo_rating_events_per_reviewer_idx
  on public.photo_rating_events (reviewer_id, created_at desc);

create index photo_rating_events_per_photo_idx
  on public.photo_rating_events (photo_id, created_at desc);

create table public.photo_rating_event_tags (
  event_id uuid not null references public.photo_rating_events(id) on delete cascade,
  tag_id   text not null references public.tags(id) on delete restrict,
  primary key (event_id, tag_id)
);

create table public.camp_week_senior_tags (
  camp_week_id uuid not null references public.camp_weeks(id) on delete cascade,
  tag_id       text not null references public.tags(id) on delete restrict,
  primary key (camp_week_id, tag_id)
);

alter table public.photos
  add column rating_claim_id uuid references public.photo_rating_claims(id) on delete set null;

-- ─── 5. Indexes ──────────────────────────────────────────────────────────────

create index camp_weeks_rating_hub_idx
  on public.camp_weeks (rating_state, rating_role)
  where rating_state <> 'not_required' and rating_state <> 'complete';

create index photos_rating_grid_idx
  on public.photos (camp_week_id, rating_state);

create index photos_rating_pending_pool_idx
  on public.photos (camp_week_id, captured_at)
  where rating_state = 'pending';

create index photos_rating_claim_idx
  on public.photos (rating_claim_id)
  where rating_claim_id is not null;

-- ─── 6. Sync rating_role with triage_role ────────────────────────────────────

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
  new.rating_role := new.triage_role;
  return new;
end;
$$;

-- ─── 7. Extend role fanout for rating ────────────────────────────────────────

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
       set triage_state = 'pending',
           rating_state = 'pending'
     where camp_week_id = new.id
       and triage_state = 'not_required';

    select count(*) into v_photo_count from public.photos where camp_week_id = new.id;

    update public.camp_weeks
       set triage_state = case
             when v_photo_count = 0 then 'awaiting_photos'::public.camp_week_triage_state
             else 'photos_in'::public.camp_week_triage_state
           end,
           rating_state = case
             when v_photo_count = 0 then 'awaiting_photos'::public.camp_week_rating_state
             else 'photos_in'::public.camp_week_rating_state
           end
     where id = new.id;
    return new;
  end if;

  if new.triage_role = 'none'
     and old.triage_role in ('first_week', 'second_week_recheck') then
    update public.photos
       set triage_state = 'not_required',
           triage_claim_id = null,
           rating_state = 'not_required',
           rating_claim_id = null
     where camp_week_id = new.id
       and triage_state in ('pending', 'in_progress');

    update public.photos
       set rating_state = 'not_required',
           rating_claim_id = null
     where camp_week_id = new.id
       and rating_state in ('pending', 'in_progress');

    update public.triage_claims
       set released_at = now(),
           release_reason = 'admin_force'
     where camp_week_id = new.id
       and released_at is null;

    update public.photo_rating_claims
       set released_at = now(),
           release_reason = 'admin_force'
     where camp_week_id = new.id
       and released_at is null;

    update public.camp_weeks
       set triage_state = 'not_required',
           rating_state = 'not_required'
     where id = new.id;
    return new;
  end if;

  return new;
end;
$$;

-- ─── 8. Photo insert/update for rating week state ────────────────────────────

create or replace function public.tg_photos_after_insert_recompute_week_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.camp_week_triage_role;
  v_week_state public.camp_week_triage_state;
  v_rating_state public.camp_week_rating_state;
begin
  select triage_role, triage_state, rating_state
    into v_role, v_week_state, v_rating_state
    from public.camp_weeks where id = new.camp_week_id;

  if v_role <> 'none' then
    new.triage_state := 'pending';
    new.rating_state := 'pending';
  else
    new.triage_state := coalesce(new.triage_state, 'not_required');
    new.rating_state := coalesce(new.rating_state, 'not_required');
  end if;

  if v_week_state = 'awaiting_photos' then
    update public.camp_weeks
       set triage_state = 'photos_in',
           rating_state = case
             when rating_state = 'awaiting_photos' then 'photos_in'::public.camp_week_rating_state
             else rating_state
           end
     where id = new.camp_week_id;
  elsif v_week_state in ('triage_done', 'senior_review', 'complete') and new.triage_state = 'pending' then
    update public.camp_weeks
       set triage_state = 'triage_in_progress',
           triage_done_at = null
     where id = new.camp_week_id;
  end if;

  if v_rating_state = 'awaiting_photos' then
    update public.camp_weeks
       set rating_state = 'photos_in'
     where id = new.camp_week_id;
  elsif v_rating_state in ('rating_done', 'complete') and new.rating_state = 'pending' then
    update public.camp_weeks
       set rating_state = 'rating_in_progress',
           rating_done_at = null
     where id = new.camp_week_id;
  end if;

  return new;
end;
$$;

create or replace function public.tg_photos_after_update_rating_state_recompute_week()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int;
  v_week_state public.camp_week_rating_state;
begin
  if old.rating_state is not distinct from new.rating_state then
    return new;
  end if;

  select rating_state into v_week_state from public.camp_weeks where id = new.camp_week_id;

  select count(*) into v_active
    from public.photos
   where camp_week_id = new.camp_week_id
     and rating_state in ('pending', 'in_progress');

  if v_active = 0 and v_week_state = 'rating_in_progress' then
    update public.camp_weeks
       set rating_state = 'rating_done',
           rating_done_at = coalesce(rating_done_at, now())
     where id = new.camp_week_id;
  elsif v_active > 0 and v_week_state = 'rating_done' then
    update public.camp_weeks
       set rating_state = 'rating_in_progress',
           rating_done_at = null
     where id = new.camp_week_id;
  end if;

  return new;
end;
$$;

create trigger tg_photos_after_update_rating_state_recompute_week
  after update of rating_state on public.photos
  for each row
  execute function public.tg_photos_after_update_rating_state_recompute_week();

-- ─── 9. Rating claims ──────────────────────────────────────────────────────────

create or replace function public.tg_photo_rating_claims_after_insert_stamp_photos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(p.id order by p.captured_at asc nulls last, p.id asc)
    into v_ids
    from (
      select id, captured_at
        from public.photos
       where camp_week_id = new.camp_week_id
         and rating_state = 'pending'
       order by captured_at asc nulls last, id asc
       limit new.slice_size
    ) p;

  if v_ids is not null and array_length(v_ids, 1) > 0 then
    update public.photos
       set rating_state = 'in_progress',
           rating_claim_id = new.id
     where id = any(v_ids);
  end if;

  update public.camp_weeks
     set rating_state = case
           when rating_state = 'photos_in' then 'rating_in_progress'::public.camp_week_rating_state
           else rating_state
         end,
         rating_started_at = coalesce(rating_started_at, now())
   where id = new.camp_week_id
     and rating_state in ('photos_in', 'rating_in_progress');

  return new;
end;
$$;

create trigger tg_photo_rating_claims_after_insert_stamp_photos
  after insert on public.photo_rating_claims
  for each row
  execute function public.tg_photo_rating_claims_after_insert_stamp_photos();

create or replace function public.tg_photo_rating_claims_after_update_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.released_at is null and new.released_at is not null then
    update public.photos
       set rating_state = 'pending',
           rating_claim_id = null
     where rating_claim_id = new.id
       and rating_state = 'in_progress';
  end if;
  return new;
end;
$$;

create trigger tg_photo_rating_claims_after_update_released
  after update of released_at on public.photo_rating_claims
  for each row
  execute function public.tg_photo_rating_claims_after_update_released();

-- ─── 10. Rating events ─────────────────────────────────────────────────────────

create or replace function public.tg_photo_rating_events_after_insert_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photos
     set rating_state = 'rated',
         is_quarantined = new.quarantine_intent or is_quarantined,
         rating_claim_id = case
           when rating_claim_id = new.claim_id and rating_state = 'in_progress' then null
           else rating_claim_id
         end
   where id = new.photo_id;

  return new;
end;
$$;

create trigger tg_photo_rating_events_after_insert_apply
  after insert on public.photo_rating_events
  for each row
  execute function public.tg_photo_rating_events_after_insert_apply();

create or replace function public.tg_photo_rating_events_after_insert_bump_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.claim_id is not null then
    update public.photo_rating_claims
       set last_activity_at = now()
     where id = new.claim_id
       and released_at is null;
  end if;
  return new;
end;
$$;

create trigger tg_photo_rating_events_after_insert_bump_claim
  after insert on public.photo_rating_events
  for each row
  execute function public.tg_photo_rating_events_after_insert_bump_claim();

create trigger tg_photo_rating_events_after_insert_bump_last_active
  after insert on public.photo_rating_events
  for each row
  execute function public.tg_triage_events_after_insert_bump_last_active();

-- ─── 11. Claim sweeper + week tags RPC ─────────────────────────────────────────

create or replace function public.photo_rating_claims_expire_inactive()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with expired as (
    update public.photo_rating_claims
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

revoke all on function public.photo_rating_claims_expire_inactive() from public;
grant execute on function public.photo_rating_claims_expire_inactive() to service_role;

create or replace function public.photo_rating_set_week_tags(
  p_camp_week_id uuid,
  p_tag_ids text[]
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

  delete from public.camp_week_senior_tags where camp_week_id = p_camp_week_id;

  if p_tag_ids is not null and array_length(p_tag_ids, 1) > 0 then
    insert into public.camp_week_senior_tags (camp_week_id, tag_id)
    select p_camp_week_id, t
      from unnest(p_tag_ids) as t
     where exists (
       select 1 from public.tags g
       where g.id = t
         and g.active
         and 'week_senior' = any(g.purposes)
     );
  end if;
end;
$$;

revoke all on function public.photo_rating_set_week_tags(uuid, text[]) from public;
grant execute on function public.photo_rating_set_week_tags(uuid, text[]) to authenticated;

-- ─── 12. RLS ─────────────────────────────────────────────────────────────────

alter table public.photo_rating_claims enable row level security;
alter table public.photo_rating_events enable row level security;
alter table public.photo_rating_event_tags enable row level security;
alter table public.camp_week_senior_tags enable row level security;

create policy photo_rating_claims_select_authenticated
  on public.photo_rating_claims for select to authenticated using (true);

create policy photo_rating_claims_insert_reviewer
  on public.photo_rating_claims for insert to authenticated
  with check (reviewer_id = auth.uid());

create policy photo_rating_claims_update_owner_or_admin
  on public.photo_rating_claims for update to authenticated
  using (reviewer_id = auth.uid() or public.is_admin())
  with check (reviewer_id = auth.uid() or public.is_admin());

create policy photo_rating_claims_delete_admin
  on public.photo_rating_claims for delete to authenticated
  using (public.is_admin());

create policy photo_rating_events_select_authenticated
  on public.photo_rating_events for select to authenticated using (true);

create policy photo_rating_events_insert_reviewer
  on public.photo_rating_events for insert to authenticated
  with check (reviewer_id = auth.uid());

create policy photo_rating_event_tags_select_authenticated
  on public.photo_rating_event_tags for select to authenticated using (true);

create policy photo_rating_event_tags_insert_owner
  on public.photo_rating_event_tags for insert to authenticated
  with check (
    exists (
      select 1 from public.photo_rating_events e
      where e.id = event_id
        and e.reviewer_id = auth.uid()
    )
  );

create policy camp_week_senior_tags_select_authenticated
  on public.camp_week_senior_tags for select to authenticated using (true);

create policy camp_week_senior_tags_write_senior
  on public.camp_week_senior_tags for all to authenticated
  using (public.is_senior_or_admin())
  with check (public.is_senior_or_admin());

-- ─── 13. Backfill ──────────────────────────────────────────────────────────────

update public.camp_weeks cw
set rating_role = cw.triage_role;

update public.photos p
set rating_state = case
  when cw.rating_role = 'none' then 'not_required'::public.photo_rating_state
  when p.rating_state = 'not_required' then 'pending'::public.photo_rating_state
  else p.rating_state
end
from public.camp_weeks cw
where p.camp_week_id = cw.id;

update public.camp_weeks cw
set rating_state = case
  when cw.rating_role = 'none' then 'not_required'::public.camp_week_rating_state
  when not exists (select 1 from public.photos p where p.camp_week_id = cw.id) then 'awaiting_photos'::public.camp_week_rating_state
  when exists (
    select 1 from public.photos p
    where p.camp_week_id = cw.id
      and p.rating_state in ('pending', 'in_progress')
  ) then 'rating_in_progress'::public.camp_week_rating_state
  when exists (
    select 1 from public.photos p
    where p.camp_week_id = cw.id
      and p.rating_state = 'rated'
  ) and not exists (
    select 1 from public.photos p
    where p.camp_week_id = cw.id
      and p.rating_state in ('pending', 'in_progress')
  ) then 'rating_done'::public.camp_week_rating_state
  when exists (select 1 from public.photos p where p.camp_week_id = cw.id) then 'photos_in'::public.camp_week_rating_state
  else 'awaiting_photos'::public.camp_week_rating_state
end
where cw.rating_role <> 'none';
