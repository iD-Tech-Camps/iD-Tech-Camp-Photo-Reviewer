-- Relax triage_signoff_camp_week so "Finish Review" is purely a per-week
-- audit marker. Approval of the location is a separate, explicit action
-- via approve_location. The two were entangled while the senior-review
-- screen still used the legacy flow; phase 3 split them so leads can
-- record per-week assessments without affecting the triage queue.
--
-- Changes:
--   - Drop the triage_state IN ('triage_done','senior_review') WHERE clause.
--     A lead decides when their review of a week is "done"; the queue
--     state doesn't gate that decision anymore.
--   - p_flag_second_week_recheck is silently ignored (the recheck side
--     effect was removed in migration 43 alongside the dropped trigger).
--     Keep the parameter for API compatibility; phase 4 removes it.
--   - The RPC no longer raises when the week is in any other state — leads
--     can stamp their review on weeks at any point in the workflow.

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
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.camp_weeks
     set signoff_at = coalesce(signoff_at, now()),
         signoff_by = coalesce(signoff_by, auth.uid())
   where id = p_camp_week_id;

  if not found then
    raise exception 'camp week not found' using errcode = 'P0002';
  end if;

  -- p_flag_second_week_recheck retained for API compatibility; no effect.
  perform p_flag_second_week_recheck;
end;
$$;
