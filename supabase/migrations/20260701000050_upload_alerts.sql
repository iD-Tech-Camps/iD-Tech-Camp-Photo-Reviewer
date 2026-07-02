-- Weekly upload alerts (additive).
--
-- Feature: flag a location that has stopped uploading photos mid-season so a
-- lead can chase it down. The signal is *relative*, not schedule-based — there
-- is no per-location expected-schedule config to maintain (see the design
-- discussion in the PR). A location is flagged when ALL of:
--   1. Its currently-active camp week (current_date between starts_on/ends_on)
--      exists and holds ZERO photos, AND
--   2. Its immediately-preceding camp week DID have photos (establishes "this
--      location was recently active" — and auto-suppresses a genuine
--      last-week-of-camp, which has no current week), AND
--   3. At least one OTHER non-ignored location received photos for its own
--      current week (circuit breaker: if nothing came in anywhere, the whole
--      sync pipeline is likely down / it's a holiday — suppress every alert
--      rather than storm the lead).
--
-- Cold-start ("never uploaded a first week") is intentionally NOT covered here;
-- that case is already surfaced by the `photos_arriving` lifecycle bucket on the
-- lead hub.
--
-- Behavior contract (per stakeholder, see PR description):
--   * The check runs weekly (Vercel Cron, Wednesday after the daily sync) via
--     generate_upload_alerts(), called under the service role.
--   * An alert is a persisted record. It STAYS until a lead dismisses it — it is
--     never auto-cleared when photos eventually arrive.
--   * One alert per (location, week_start): re-running never duplicates and a
--     dismissed alert is never re-raised (ON CONFLICT DO NOTHING). The next
--     week is a new week_start, so a still-silent location alerts afresh.
--
-- Display fields (location_name / division_name / week_label) are snapshotted at
-- detection time so the dismissed-alert history stays accurate even if a
-- location is renamed or a camp_week row is later removed.

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

create table public.upload_alerts (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references public.locations(id) on delete cascade,
  camp_week_id   uuid references public.camp_weeks(id) on delete set null,
  week_start     date not null,
  location_name  text not null,
  division_name  text not null,
  week_label     text not null,
  detected_at    timestamptz not null default now(),
  dismissed_at   timestamptz,
  dismissed_by   uuid references public.profiles(id) on delete set null,
  check ((dismissed_at is null) = (dismissed_by is null))
);

-- One alert per location per missed week, ever. Dismissed or not, a second
-- detection of the same (location, week) is a no-op via ON CONFLICT.
create unique index upload_alerts_location_week_uq
  on public.upload_alerts (location_id, week_start);

-- Feed order for the hub: undismissed first, newest first.
create index upload_alerts_feed_idx
  on public.upload_alerts (dismissed_at, detected_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — read-only for authenticated callers. Generation runs under the service
-- role; dismissal goes through the SECURITY DEFINER RPC below. No direct client
-- INSERT/UPDATE/DELETE policy exists.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.upload_alerts enable row level security;

create policy upload_alerts_select_authenticated
  on public.upload_alerts for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Generation RPC — called weekly by the cron route under the service role.
-- Returns the rows it newly inserted (empty set when the circuit breaker trips
-- or nothing is flagged).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.generate_upload_alerts()
returns setof public.upload_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_peers_uploaded boolean;
begin
  -- Circuit breaker (clause 3): did ANY non-ignored location receive photos for
  -- its current (active today) camp week? If not, assume a systemic gap and
  -- suppress all alerts.
  select exists (
    select 1
      from public.camp_weeks cw
      join public.locations l on l.id = cw.location_id and l.is_ignored = false
     where current_date between cw.starts_on and cw.ends_on
       and exists (select 1 from public.photos p where p.camp_week_id = cw.id)
  ) into v_peers_uploaded;

  if not v_peers_uploaded then
    return;
  end if;

  return query
  with current_week as (
    -- Each non-ignored location's currently-active camp week. If ranges
    -- overlap, take the latest-starting one.
    select distinct on (cw.location_id)
           cw.location_id,
           cw.id         as camp_week_id,
           cw.name       as week_label,
           cw.starts_on
      from public.camp_weeks cw
      join public.locations l on l.id = cw.location_id and l.is_ignored = false
     where current_date between cw.starts_on and cw.ends_on
     order by cw.location_id, cw.starts_on desc
  ),
  flagged as (
    select c.location_id, c.camp_week_id, c.week_label, c.starts_on
      from current_week c
     where
       -- (1) current week has no photos
       not exists (select 1 from public.photos p where p.camp_week_id = c.camp_week_id)
       -- (2) the immediately-preceding week at this location DID have photos
       and exists (
         select 1
           from (
             select pw.id
               from public.camp_weeks pw
              where pw.location_id = c.location_id
                and pw.starts_on < c.starts_on
              order by pw.starts_on desc
              limit 1
           ) prev
           join public.photos p on p.camp_week_id = prev.id
       )
  )
  insert into public.upload_alerts
    (location_id, camp_week_id, week_start, location_name, division_name, week_label)
  select f.location_id,
         f.camp_week_id,
         f.starts_on,
         l.name,
         coalesce(d.name, '—'),
         f.week_label
    from flagged f
    join public.locations l on l.id = f.location_id
    left join public.divisions d on d.id = l.division_id
  on conflict (location_id, week_start) do nothing
  returning *;
end;
$$;

revoke all on function public.generate_upload_alerts() from public, anon, authenticated;
grant execute on function public.generate_upload_alerts() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Dismiss RPC — senior/admin only. Idempotent-guarded: dismissing an already
-- dismissed alert raises P0002 (surfaced by the API as a 409).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.dismiss_upload_alert(p_alert_id uuid)
returns public.upload_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.upload_alerts;
begin
  if not public.is_senior_or_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.upload_alerts
     set dismissed_at = now(),
         dismissed_by = auth.uid()
   where id = p_alert_id
     and dismissed_at is null
  returning * into v_row;

  if not found then
    raise exception 'no active alert to dismiss' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.dismiss_upload_alert(uuid) from public;
grant execute on function public.dismiss_upload_alert(uuid) to authenticated;
