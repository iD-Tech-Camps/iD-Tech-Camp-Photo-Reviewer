-- Lead unflag: senior approves a flagged photo (same end state as reviewer clean).

alter type public.triage_event_kind add value if not exists 'senior_unflag';

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
    when 'senior_unflag' then
      update public.photos
         set triage_state = 'clean',
             is_quarantined = false,
             triage_claim_id = null
       where id = new.photo_id;
      perform public.triage_maybe_enter_senior_review(v_camp_week_id);
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

drop policy if exists triage_events_insert_senior on public.triage_events;

create policy triage_events_insert_senior
  on public.triage_events for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and public.is_senior_or_admin()
    and kind in (
      'senior_delete',
      'senior_quarantine',
      'senior_release_quarantine',
      'senior_unflag'
    )
  );
