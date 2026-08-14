-- Admin → Overview stats summary (additive, read-only).
--
-- The summary needs ~20 counts across photos / camp_weeks / locations. Doing
-- that from the client means ~20 PostgREST `count: exact` head requests, each
-- its own round trip and its own scan. This function scans each table once
-- with FILTER aggregates and returns the whole summary as a single jsonb blob.
--
-- SECURITY INVOKER (the default) on purpose: every table read here is already
-- readable by any authenticated user under the existing RLS policies
-- (photos_select_authenticated, camp_weeks_select_authenticated,
-- locations_select_authenticated), so the function exposes nothing new — it
-- only saves round trips. The screen that calls it is admin-gated in the UI.

create or replace function public.admin_overview_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'photos', (
      select jsonb_build_object(
        'total',                count(*),
        -- Camp Quality Review pipeline. 'not_required' is the out-of-scope
        -- bucket: weeks outside the sample, or locations whose approval was
        -- never granted / was revoked.
        'triage_not_required',  count(*) filter (where triage_state = 'not_required'),
        'triage_pending',       count(*) filter (where triage_state = 'pending'),
        'triage_in_progress',   count(*) filter (where triage_state = 'in_progress'),
        'triage_clean',         count(*) filter (where triage_state = 'clean'),
        'triage_flagged',       count(*) filter (where triage_state = 'flagged'),
        'triage_deleted',       count(*) filter (where triage_state = 'deleted'),
        -- Camp Photo Review (star rating) pipeline.
        'rating_not_required',  count(*) filter (where rating_state = 'not_required'),
        'rating_pending',       count(*) filter (where rating_state = 'pending'),
        'rating_in_progress',   count(*) filter (where rating_state = 'in_progress'),
        'rating_rated',         count(*) filter (where rating_state = 'rated'),
        'quarantined',          count(*) filter (where is_quarantined)
      )
      from public.photos
    ),
    'weeks', (
      select jsonb_build_object(
        'total',            count(*),
        'awaiting_photos',  count(*) filter (where triage_state = 'awaiting_photos'),
        'not_started',      count(*) filter (where triage_state = 'photos_in'),
        'in_review',        count(*) filter (where triage_state = 'triage_in_progress'),
        'awaiting_lead',    count(*) filter (
                              where triage_state in ('triage_done', 'senior_review')
                                and signoff_at is null
                            ),
        'signed_off',       count(*) filter (where signoff_at is not null),
        'not_required',     count(*) filter (where triage_state = 'not_required')
      )
      from public.camp_weeks
    ),
    'locations', (
      select jsonb_build_object(
        'total',    count(*),
        'ignored',  count(*) filter (where is_ignored),
        -- Approved for the *current* season only — an approval from a past
        -- season doesn't put this season's photos into the review pool.
        'approved', count(*) filter (
                      where exists (
                        select 1
                          from public.location_approvals la
                         where la.location_id = l.id
                           and la.revoked_at is null
                           and la.season_start = (
                             select tc.season_first_week_start
                               from public.triage_config tc
                              where tc.id = 1
                           )
                      )
                    )
      )
      from public.locations l
    )
  );
$$;

grant execute on function public.admin_overview_stats() to authenticated;
