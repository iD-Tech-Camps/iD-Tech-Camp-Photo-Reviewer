-- Step 7.5 — `reviewer_stats` view
--
-- The Profile screen (one reviewer at a time) and the merged Admin Overview
-- roster (every reviewer) both want the same shape: identity columns from
-- `profiles` plus aggregated counts/sums from `reviews`. Computing those
-- aggregates client-side would mean fetching every review row to JS just to
-- group them, so we expose a view that pushes the work down to Postgres.
--
-- Why a view (and not an RPC):
--   * Same shape works for both the single-row and roster queries — the app
--     just adds `.eq('id', uid)` or omits it.
--   * PostgREST handles views the same as tables; no RPC plumbing.
--   * It's the same pattern already used for `camp_weeks_with_status`.
--
-- `security_invoker = true` makes the view enforce RLS on the underlying
-- tables (profiles + reviews) using the caller's role rather than the view
-- owner's. Both base tables already grant `select` to authenticated, so the
-- view is effectively readable by every signed-in user; making that explicit
-- via security_invoker means we won't accidentally leak data if either base
-- table's RLS tightens later.

create view public.reviewer_stats with (security_invoker = true) as
select
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.team,
  p.status,
  p.created_at,
  p.last_active_at,
  coalesce(s.total_reviews,  0)::int  as total_reviews,
  coalesce(s.approves,       0)::int  as approves,
  coalesce(s.flags,          0)::int  as flags,
  coalesce(s.deletes,        0)::int  as deletes,
  coalesce(s.total_points,   0)::int  as total_points,
  s.last_reviewed_at,
  coalesce(s.reviewed_today, 0)::int  as reviewed_today
from public.profiles p
left join (
  select
    reviewer_id,
    count(*)                                                      as total_reviews,
    count(*) filter (where decision = 'approve')                  as approves,
    count(*) filter (where decision = 'flag')                     as flags,
    count(*) filter (where decision = 'delete')                   as deletes,
    sum(points_awarded)                                           as total_points,
    max(created_at)                                               as last_reviewed_at,
    count(*) filter (where created_at >= current_date)            as reviewed_today
  from public.reviews
  group by reviewer_id
) s on s.reviewer_id = p.id;

-- Grants. Views don't auto-inherit from base-table grants, even with
-- security_invoker = true — that flag controls *RLS* evaluation, not
-- table-level GRANTs. So we have to grant SELECT explicitly here.
grant select on public.reviewer_stats to authenticated;
