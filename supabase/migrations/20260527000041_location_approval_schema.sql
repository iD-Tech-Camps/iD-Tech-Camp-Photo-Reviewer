-- Location approval — Phase 1 (additive schema).
-- See spec/LOCATION_APPROVAL_SPEC.md §3.
--
-- Non-breaking: this migration adds tables, view, RPC, RLS, and backfills
-- approvals for camp_weeks that are currently signed off in the active season.
-- No existing triggers are modified and no behavior changes until Phase 2
-- (migrations 42 + 43).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table public.location_approvals (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references public.locations(id) on delete cascade,
  season_start      date not null,
  approved_by       uuid not null references public.profiles(id) on delete restrict,
  approved_at       timestamptz not null default now(),
  revoked_by        uuid references public.profiles(id) on delete restrict,
  revoked_at        timestamptz,
  revocation_reason text,
  check ((revoked_at is null) = (revoked_by is null))
);

-- Partial unique index: only one active (unrevoked) approval per
-- (location, season). Two leads racing to approve resolves to a 23505 on the
-- second insert, which the API surfaces as a client-visible 409.
create unique index location_approvals_active_uq
  on public.location_approvals (location_id, season_start)
  where revoked_at is null;

create index location_approvals_location_season_idx
  on public.location_approvals (location_id, season_start, approved_at desc);

create table public.location_feedback_events (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.locations(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete restrict,
  body          text not null check (length(body) > 0),
  camp_week_id  uuid references public.camp_weeks(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index location_feedback_events_location_idx
  on public.location_feedback_events (location_id, created_at desc);

create table public.location_feedback_event_tags (
  event_id uuid not null references public.location_feedback_events(id) on delete cascade,
  tag_id   text not null references public.tags(id) on delete restrict,
  primary key (event_id, tag_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper view + RPC
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per location, joined with the most-recent approval for the current
-- season (regardless of revoked state). `approval_status` is a derived label
-- the UI and triggers consume; the underlying revoke timestamp distinguishes
-- "approved" from "reopened" (had one, was revoked).
create or replace view public.locations_with_approval as
select
  l.*,
  la.id          as approval_id,
  la.approved_by,
  la.approved_at,
  la.revoked_at,
  la.revoked_by,
  case
    when la.id is null then 'unapproved'::text
    when la.revoked_at is null then 'approved'::text
    else 'reopened'::text
  end as approval_status
from public.locations l
left join lateral (
  select *
    from public.location_approvals
   where location_id = l.id
     and season_start = (select season_first_week_start from public.triage_config where id = 1)
   -- Prefer an active (unrevoked) row if one exists, regardless of timestamp.
   -- Falling back to approved_at desc covers the all-revoked case (renders
   -- as 'reopened' so the UI nudges a re-review).
   order by (revoked_at is null) desc, approved_at desc
   limit 1
) la on true;

-- Trigger-callable check. Returns true when the location has an active
-- (unrevoked) approval for the current season. SECURITY DEFINER so triggers
-- invoked under service role still resolve under stable search_path.
create or replace function public.is_location_approved(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.location_approvals
     where location_id = p_location_id
       and season_start = (select season_first_week_start from public.triage_config where id = 1)
       and revoked_at is null
  );
$$;

revoke all on function public.is_location_approved(uuid) from public;
grant execute on function public.is_location_approved(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- Read-only for authenticated callers. Direct INSERT/UPDATE/DELETE from
-- clients is denied (no policy). Phase 2 ships SECURITY DEFINER RPCs for
-- approve / revoke / feedback that bypass these policies.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.location_approvals          enable row level security;
alter table public.location_feedback_events    enable row level security;
alter table public.location_feedback_event_tags enable row level security;

create policy location_approvals_select_authenticated
  on public.location_approvals for select to authenticated using (true);

create policy location_feedback_events_select_authenticated
  on public.location_feedback_events for select to authenticated using (true);

-- Feedback writes are allowed directly from senior/admin callers (no RPC
-- needed — there are no drain side effects). Tag junction follows the parent.
create policy location_feedback_events_insert_senior
  on public.location_feedback_events for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_senior_or_admin()
  );

create policy location_feedback_events_update_author_or_admin
  on public.location_feedback_events for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

create policy location_feedback_events_delete_admin
  on public.location_feedback_events for delete to authenticated
  using (public.is_admin());

create policy location_feedback_event_tags_select_authenticated
  on public.location_feedback_event_tags for select to authenticated using (true);

create policy location_feedback_event_tags_insert_owner
  on public.location_feedback_event_tags for insert to authenticated
  with check (
    exists (
      select 1 from public.location_feedback_events e
       where e.id = event_id
         and (e.author_id = auth.uid() or public.is_admin())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill — current season only.
-- Insert one location_approvals row for each location whose most-recent
-- signed-off camp_week falls in the current season. Idempotent by virtue of
-- the partial unique index: re-running this migration would 23505 on conflict.
-- We use INSERT … ON CONFLICT DO NOTHING so a re-reset is clean.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
  v_season_start date;
  v_season_end   date;
begin
  select season_first_week_start, season_last_week_start
    into v_season_start, v_season_end
    from public.triage_config where id = 1;

  if v_season_start is null then
    raise notice 'location_approvals backfill skipped: no triage_config row';
    return;
  end if;

  with src as (
    select distinct on (cw.location_id)
      cw.location_id,
      v_season_start as season_start,
      cw.signoff_by  as approved_by,
      cw.signoff_at  as approved_at
    from public.camp_weeks cw
    where cw.triage_state = 'complete'
      and cw.signoff_at is not null
      and cw.signoff_by is not null
      and cw.starts_on between v_season_start and v_season_end
    order by cw.location_id, cw.signoff_at desc
  ),
  inserted as (
    insert into public.location_approvals (location_id, season_start, approved_by, approved_at)
    select location_id, season_start, approved_by, approved_at from src
    on conflict do nothing
    returning id
  )
  select count(*) into v_count from inserted;

  raise notice 'location_approvals backfill: % rows inserted for season starting %', v_count, v_season_start;
end;
$$;
