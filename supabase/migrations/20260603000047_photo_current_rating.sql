-- Denormalize the current star rating onto photos so the marketing Photo
-- Library can filter / sort / paginate the rated pool server-side (PostgREST
-- can't sort by "latest rating event" without a column on photos).
--
-- A photo is only ever rated by one reviewer (the rating claim selector only
-- picks rating_state = 'pending' photos, so a rated photo leaves the pool).
-- An "Update" in the rating lightbox appends a newer event by the same
-- reviewer, so the latest event always reflects the current rating — which is
-- exactly what the after-insert trigger sees in NEW.rating.
-- See spec/PHOTO_RATING_SPEC.md.

-- ─── 1. Column ───────────────────────────────────────────────────────────────

alter table public.photos
  add column current_rating smallint;  -- null = unrated; 1..5 once rated

-- ─── 2. Maintain it in the existing rating-event trigger ─────────────────────
-- Unchanged from 20260520000034 except the added current_rating assignment.

create or replace function public.tg_photo_rating_events_after_insert_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.photos
     set rating_state = 'rated',
         current_rating = new.rating,
         is_quarantined = new.quarantine_intent or is_quarantined,
         rating_claim_id = case
           when rating_claim_id = new.claim_id and rating_state = 'in_progress' then null
           else rating_claim_id
         end
   where id = new.photo_id;

  return new;
end;
$$;

-- ─── 3. Index for the gallery query ──────────────────────────────────────────

create index photos_rated_gallery_idx
  on public.photos (current_rating desc, captured_at desc)
  where rating_state = 'rated' and is_quarantined = false;

-- ─── 4. Backfill from the latest event per photo ─────────────────────────────

update public.photos p
   set current_rating = e.rating
  from (
    select distinct on (photo_id) photo_id, rating
      from public.photo_rating_events
     order by photo_id, created_at desc
  ) e
 where e.photo_id = p.id;
