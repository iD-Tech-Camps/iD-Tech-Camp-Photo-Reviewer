-- Step 6.2 — Seed dev folder hierarchy + photos
--
-- Lets the app exercise the schema before SmugMug ingest is wired in step 7.
-- All four production divisions are seeded so admin/dropdown UIs preview the
-- real division list. A single location ("Adelphi University") and a single
-- camp week ("May 25 – May 29, 2026") are seeded under "iD Tech Camps", and
-- the prototype's SESSION_PHOTOS list is mapped into ten `photos` rows under
-- that week so the reviewer queue has something to render.
--
-- Every smugmug_folder_id / smugmug_image_id is prefixed with `placeholder-`
-- so the SmugMug import job (step 7) can `update ... where smugmug_*_id like
-- 'placeholder-%'` to swap in real ids when the real data lands. The `where
-- not exists` / `on conflict do nothing` patterns make this migration
-- idempotent.

-- 1. Divisions (the four real top-level SmugMug folders)
insert into public.divisions (name, smugmug_folder_id) values
  ('iD Tech Camps',          'placeholder-division-id-tech-camps'),
  ('iD Teen Academies',      'placeholder-division-id-teen-academies'),
  ('Online Private Lessons', 'placeholder-division-online-private-lessons'),
  ('Virtual Tech Camps',     'placeholder-division-virtual-tech-camps')
on conflict (smugmug_folder_id) do nothing;

-- 2. One test location under "iD Tech Camps"
insert into public.locations (division_id, name, smugmug_folder_id)
select d.id, 'Adelphi University', 'placeholder-location-adelphi-university'
from public.divisions d
where d.smugmug_folder_id = 'placeholder-division-id-tech-camps'
on conflict (smugmug_folder_id) do nothing;

-- 3. One test camp week under that location
insert into public.camp_weeks (location_id, name, smugmug_folder_id, starts_on, ends_on)
select l.id,
       'May 25 – May 29, 2026',
       'placeholder-week-adelphi-may-25-2026',
       date '2026-05-25',
       date '2026-05-29'
from public.locations l
where l.smugmug_folder_id = 'placeholder-location-adelphi-university'
on conflict (smugmug_folder_id) do nothing;

-- 4. Ten photos under that week — mirrors SESSION_PHOTOS in components/data.tsx.
-- captured_at uses Eastern Time (Adelphi is in Garden City, NY) on
-- 2026-05-26 (Tuesday of the seeded week). Resolution and times are taken
-- straight from the prototype's mock data.
with target_week as (
  select id from public.camp_weeks
  where smugmug_folder_id = 'placeholder-week-adelphi-may-25-2026'
)
insert into public.photos (
  camp_week_id,
  smugmug_image_id,
  caption,
  captured_at,
  width,
  height
)
select tw.id, p.smugmug_image_id, p.caption, p.captured_at, p.width, p.height
from target_week tw,
  (values
    ('placeholder-IMG_4821', 'Unity workshop',     timestamptz '2026-05-26 10:42:00-04', 1600, 1067),
    ('placeholder-IMG_4822', 'Unity workshop',     timestamptz '2026-05-26 10:44:00-04', 1600, 1067),
    ('placeholder-IMG_4823', 'Lunch — dining',     timestamptz '2026-05-26 12:18:00-04', 1600, 1067),
    ('placeholder-IMG_4824', 'VEX build lab',      timestamptz '2026-05-26 14:03:00-04', 1600, 1067),
    ('placeholder-IMG_4825', 'Editing session',    timestamptz '2026-05-26 14:41:00-04', 1600, 1067),
    ('placeholder-IMG_4826', 'Outdoor shoot',      timestamptz '2026-05-26 15:15:00-04', 1600, 1067),
    ('placeholder-IMG_4827', 'Demo day rehearsal', timestamptz '2026-05-26 15:48:00-04', 1600, 1067),
    ('placeholder-IMG_4828', 'Team photo',         timestamptz '2026-05-26 16:02:00-04', 1600, 1067),
    ('placeholder-IMG_4829', 'Free time — rec',    timestamptz '2026-05-26 16:30:00-04', 1600, 1067),
    ('placeholder-IMG_4830', 'End-of-day wrap',    timestamptz '2026-05-26 17:12:00-04', 1600, 1067)
  ) as p(smugmug_image_id, caption, captured_at, width, height)
on conflict (smugmug_image_id) do nothing;
