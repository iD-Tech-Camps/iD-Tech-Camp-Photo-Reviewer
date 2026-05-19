-- Migration 32 — Gamification V1 (points only).
-- See spec/GAMIFICATION_SPEC.md.
--
-- A source-agnostic ledger keyed by (source_kind, source_id) so future surfaces
-- (e.g. the planned rating system) can plug into the same table without a
-- schema rewrite. V1 only populates 'triage_event'. The trigger fires once per
-- reviewer-completed photo (kind in ('clean', 'flag')); senior kinds earn
-- nothing. Rule lookups happen at insert time and the row snapshots the
-- awarded value, so later rule changes never rewrite history.
--
-- No backfill: points accrue from the day this migration lands. See §0.5.

-- ─── 1. Enum (§1a) ──────────────────────────────────────────────────────────

create type public.points_source as enum ('triage_event');

-- ─── 2. Tables (§1b) ────────────────────────────────────────────────────────

create table public.points_rules (
  source_kind  public.points_source primary key,
  points       int not null check (points >= 0),
  updated_at   timestamptz not null default now()
);

-- No FK on points_ledger.source_id: different source_kinds reference different
-- tables and Postgres has no native polymorphic FK. Integrity is enforced at
-- the trigger. No (source_kind, source_id) uniqueness — leaves room for a
-- future event type to award multiple ledger rows per source row.
create table public.points_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  source_kind  public.points_source not null,
  source_id    uuid not null,
  points       int not null check (points >= 0),
  occurred_at  timestamptz not null default now()
);

create index points_ledger_user_idx
  on public.points_ledger (user_id, occurred_at desc);

create index points_ledger_source_idx
  on public.points_ledger (source_kind, source_id);

-- ─── 3. View (§1c) ──────────────────────────────────────────────────────────
-- Invoker-rights view: reviewers see only their own aggregated row and admins
-- see all, matching the RLS shape on points_ledger.

create or replace view public.user_points_totals as
select
  user_id,
  count(*)::int as event_count,
  coalesce(sum(points), 0)::int as total_points
from public.points_ledger
group by user_id;

-- ─── 4. Trigger (§2) ────────────────────────────────────────────────────────
-- SECURITY DEFINER because authenticated clients have no insert policy on
-- points_ledger — only this trigger writes. Filter is reviewer kinds only;
-- senior kinds are ignored. If the rule row is missing (shouldn't happen
-- post-seed) the trigger no-ops and raises a warning. points = 0 still
-- inserts (§0.6 — "record activity without awarding").

create or replace function public.tg_triage_events_after_insert_award_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points int;
begin
  if new.kind not in ('clean', 'flag') then
    return new;
  end if;

  select points into v_points
    from public.points_rules
   where source_kind = 'triage_event';

  if v_points is null then
    raise warning 'points_rules row for source_kind=triage_event missing; no ledger insert for triage_event %', new.id;
    return new;
  end if;

  insert into public.points_ledger (user_id, source_kind, source_id, points, occurred_at)
  values (new.reviewer_id, 'triage_event', new.id, v_points, new.created_at);

  return new;
end;
$$;

create trigger tg_triage_events_after_insert_award_points
  after insert on public.triage_events
  for each row
  execute function public.tg_triage_events_after_insert_award_points();

-- ─── 5. RLS (§3) ────────────────────────────────────────────────────────────

alter table public.points_rules  enable row level security;
alter table public.points_ledger enable row level security;

create policy points_rules_select_authenticated
  on public.points_rules for select to authenticated using (true);

create policy points_rules_update_admin
  on public.points_rules for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- No insert/delete policies — seed handles the initial row, future enum
-- additions arrive via migration.

create policy points_ledger_select_self_or_admin
  on public.points_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policies on points_ledger — the SECURITY DEFINER
-- trigger is the only writer.

-- ─── 6. Seed (§1d) ──────────────────────────────────────────────────────────

insert into public.points_rules (source_kind, points) values ('triage_event', 1);
