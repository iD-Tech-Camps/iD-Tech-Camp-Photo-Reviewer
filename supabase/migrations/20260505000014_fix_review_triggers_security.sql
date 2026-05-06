-- Step 6.x — Make the four review triggers SECURITY DEFINER
--
-- The triggers from 20260505000006_reviews_and_triggers.sql ran as the
-- invoker. Their inner UPDATEs on `public.photos` were therefore evaluated
-- under the caller's RLS context, and `photos` has no UPDATE policy for
-- authenticated users (writes are reserved for the SmugMug import job via
-- the service role). Result: real client inserts produced reviews rows but
-- left photos.current_status / is_quarantined unchanged, so reviewed photos
-- kept coming back into the pending queue.
--
-- The schema-level smoke test missed this because `supabase db query` runs
-- as the service role and bypasses RLS entirely.
--
-- Fix: mark each trigger function `security definer` with a pinned search
-- path. Same pattern the schema already uses for is_admin(),
-- is_senior_or_admin(), and handle_new_user(). The triggers themselves are
-- bound to functions by name so we don't need to drop and recreate them.
--
-- Backfill: any photo whose current_status doesn't match its latest review's
-- decision is reconciled at the bottom of this migration. Idempotent — a
-- second run is a no-op against already-correct rows.

-- Trigger 1: snapshot points_awarded
create or replace function public.reviews_snapshot_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg record;
begin
  if new.points_awarded is null or new.points_awarded = 0 then
    select approve_points, flag_points, delete_points
      into cfg
      from public.points_config
      where id = 1;

    if cfg is not null then
      new.points_awarded := case new.decision
        when 'approve' then cfg.approve_points
        when 'flag'    then cfg.flag_points
        when 'delete'  then cfg.delete_points
      end;
    end if;
  end if;
  return new;
end;
$$;

-- Trigger 2: maintain photos.current_status
create or replace function public.reviews_update_photo_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photos
     set current_status = case new.decision
                            when 'approve' then 'approved'::photo_status
                            when 'flag'    then 'flagged'::photo_status
                            when 'delete'  then 'deleted'::photo_status
                          end,
         updated_at = now()
   where id = new.photo_id;
  return new;
end;
$$;

-- Trigger 3: maintain photos.is_quarantined
create or replace function public.reviews_update_quarantine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.decision = 'flag' and new.quarantine = true then
    update public.photos set is_quarantined = true  where id = new.photo_id;
  elsif new.decision in ('approve', 'delete') then
    update public.photos set is_quarantined = false where id = new.photo_id;
  end if;
  return new;
end;
$$;

-- Trigger 4: bump profiles.last_active_at
create or replace function public.reviews_bump_last_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_active_at = now()
   where id = new.reviewer_id;
  return new;
end;
$$;

-- One-time reconciliation for any rows that missed the trigger updates while
-- the bug was live. Updates each affected photo's current_status (and
-- is_quarantined for approve/delete latest reviews; flag-without-quarantine
-- intentionally leaves is_quarantined alone).
update public.photos p
   set current_status = case latest.decision
                          when 'approve' then 'approved'::photo_status
                          when 'flag'    then 'flagged'::photo_status
                          when 'delete'  then 'deleted'::photo_status
                        end,
       is_quarantined = case
                          when latest.decision = 'flag' and latest.quarantine = true then true
                          when latest.decision in ('approve', 'delete') then false
                          else p.is_quarantined
                        end,
       updated_at = now()
  from (
        select distinct on (photo_id) photo_id, decision, quarantine
          from public.reviews
         order by photo_id, created_at desc
       ) latest
 where latest.photo_id = p.id
   and (
         p.current_status::text <> case latest.decision
                                     when 'approve' then 'approved'
                                     when 'flag'    then 'flagged'
                                     when 'delete'  then 'deleted'
                                   end
         or (latest.decision = 'flag' and latest.quarantine = true and p.is_quarantined = false)
         or (latest.decision in ('approve', 'delete') and p.is_quarantined = true)
       );
