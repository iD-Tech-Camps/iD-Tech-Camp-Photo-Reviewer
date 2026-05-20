-- Continuation of 35: seed rule + award trigger (after enum value is committed).

insert into public.points_rules (source_kind, points)
values ('photo_rating_event', 1)
on conflict (source_kind) do nothing;

create or replace function public.tg_photo_rating_events_after_insert_award_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points int;
begin
  select coalesce(
    (select points from public.points_rules where source_kind = 'photo_rating_event'),
    (select points from public.points_rules where source_kind = 'triage_event'),
    0
  ) into v_points;

  if v_points is null then
    raise warning 'points_rules missing for photo_rating_event; no ledger insert for %', new.id;
    return new;
  end if;

  insert into public.points_ledger (user_id, source_kind, source_id, points, occurred_at)
  values (new.reviewer_id, 'photo_rating_event', new.id, v_points, new.created_at);

  return new;
end;
$$;

create trigger tg_photo_rating_events_after_insert_award_points
  after insert on public.photo_rating_events
  for each row
  execute function public.tg_photo_rating_events_after_insert_award_points();
