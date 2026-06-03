-- Let admins/leads mark a location as "ignored" so it disappears from every
-- review surface (Camp Photo Review hub, Camp Quality Review hub, Lead review
-- hub) and the Photo Library. Use case: test/junk locations like "zz TEST".

-- ─── 1. Column ───────────────────────────────────────────────────────────────

alter table public.locations
  add column is_ignored boolean not null default false;

-- ─── 2. Surface it on the lead-hub view ──────────────────────────────────────
-- locations_with_approval lists explicit columns, so append is_ignored. New
-- column goes at the end (the only shape change create-or-replace allows).

create or replace view public.locations_with_approval as
  select
    l.id,
    l.division_id,
    l.name,
    l.smugmug_folder_id,
    l.created_at,
    l.evergreen_notes,
    la.id          as approval_id,
    la.approved_by,
    la.approved_at,
    la.revoked_at,
    la.revoked_by,
    case
      when la.id is null then 'unapproved'
      when la.revoked_at is null then 'approved'
      else 'reopened'
    end as approval_status,
    l.is_ignored
  from public.locations l
  left join lateral (
    select
      location_approvals.id,
      location_approvals.location_id,
      location_approvals.season_start,
      location_approvals.approved_by,
      location_approvals.approved_at,
      location_approvals.revoked_by,
      location_approvals.revoked_at,
      location_approvals.revocation_reason
    from public.location_approvals
    where location_approvals.location_id = l.id
      and location_approvals.season_start = (
        select triage_config.season_first_week_start from public.triage_config where triage_config.id = 1
      )
    order by (location_approvals.revoked_at is null) desc, location_approvals.approved_at desc
    limit 1
  ) la on true;

-- ─── 3. Constrained write RPC (leads can't UPDATE locations directly) ────────
-- locations UPDATE is admin-only via RLS; leads need to hide test locations
-- too, so route the single-column write through a SECURITY DEFINER RPC gated
-- to senior-or-admin (same pattern as other constrained writes — TRIAGE_SPEC Q3).

create or replace function public.set_location_ignored(
  p_location_id uuid,
  p_ignored boolean
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
  update public.locations set is_ignored = p_ignored where id = p_location_id;
end;
$$;

revoke all on function public.set_location_ignored(uuid, boolean) from public;
grant execute on function public.set_location_ignored(uuid, boolean) to authenticated;
