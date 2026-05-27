-- Tag valence + nullable category.
--
-- Three rules from the product side:
--   - Camp Quality Review tags (purpose 'quality_flag') are always NEGATIVE.
--   - Camp Photo Review tags (purpose 'photo_rating') are always POSITIVE.
--   - Week assessment tags (purpose 'week_senior' only) may be either.
--
-- Category drives the senior-dashboard rollup, which only consumes
-- 'quality_flag' tags. It's now nullable so non-quality tags don't carry a
-- bogus bucket.

-- 1. Valence column. Default 'negative' so existing inserters that don't know
--    about valence (test fixtures, future quality_flag seeds) keep working.

alter table public.tags
  add column valence text not null default 'negative';

-- Backfill positives:
--   - any tag carrying 'photo_rating' but not 'quality_flag' is positive
--   - the two seeded week_senior positives are positive
update public.tags
   set valence = 'positive'
 where 'photo_rating' = any(purposes)
   and not ('quality_flag' = any(purposes));

update public.tags
   set valence = 'positive'
 where id in ('great-quality-week', 'great-variety-week');

alter table public.tags
  add constraint tags_valence_check check (valence in ('positive', 'negative'));

-- 2. Category becomes nullable and is cleared for tags that don't carry
--    'quality_flag'. Default stays 'general' so old quality_flag inserts that
--    omit category continue to land in the general bucket.

alter table public.tags
  alter column category drop not null;

update public.tags
   set category = null
 where not ('quality_flag' = any(purposes));

-- 3. One-time cleanup: prior seeds gave some tags both 'quality_flag' and
--    'photo_rating'. Under the new rules those purposes are mutually
--    exclusive (one is negative-only, the other positive-only). Keep
--    'quality_flag' since the affected tags ('blurry-photos', etc.) are
--    negative issues, and drop 'photo_rating'. Historical
--    photo_rating_event_tags rows are unaffected.

update public.tags
   set purposes = array_remove(purposes, 'photo_rating')
 where 'quality_flag' = any(purposes)
   and 'photo_rating' = any(purposes);

-- 4. Constraints couple valence to purpose:
--    - quality_flag in purposes  ⇒ valence must be 'negative'
--    - photo_rating in purposes  ⇒ valence must be 'positive'
--    - quality_flag and photo_rating can't both be in purposes (no valid valence)
--    Plus: quality_flag tags must have a category (drives the rollup).

alter table public.tags
  add constraint tags_purposes_no_quality_and_rating check (
    not ('quality_flag' = any(purposes) and 'photo_rating' = any(purposes))
  );

alter table public.tags
  add constraint tags_valence_matches_purposes check (
    (not ('quality_flag' = any(purposes)) or valence = 'negative')
    and
    (not ('photo_rating' = any(purposes)) or valence = 'positive')
  );

alter table public.tags
  add constraint tags_category_required_for_quality_flag check (
    not ('quality_flag' = any(purposes)) or category is not null
  );
