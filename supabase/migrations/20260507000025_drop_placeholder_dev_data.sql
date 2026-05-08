-- Step 8.8 — drop step-6.2 placeholder dev data
--
-- Migration 13 (step 6.2) seeded a placeholder location, camp week,
-- and 10 photos under "iD Tech Camps" so the prototype could exercise
-- the schema before SmugMug ingest was wired in step 8. By step 8.4
-- photo sync is the real thing, by 8.5 the operational dashboard runs
-- it on real folders, and by 8.7 quarantine is wired to live SmugMug
-- images — the placeholder rows have outlived their usefulness and
-- shouldn't ship to production alongside real data.
--
-- This migration drops the placeholder photos, the placeholder camp
-- week, and the placeholder location. The four *divisions* seeded by
-- migration 13 stay — those are real top-level SmugMug folders whose
-- placeholder smugmug_folder_id values get rewritten in place by the
-- 8.3 folder-tree sync once it discovers the real ids. Removing them
-- here would either re-create them on the next folder sync (no harm,
-- but pointless churn) or leave the production environment without
-- the bootstrap rows the admin needs to flip `synced=true` on.
--
-- Production safety: the filters below match by the unique
-- `placeholder-` prefix the seed migration used. If the 8.3 folder
-- sync has already run and rewritten the week/location's
-- `smugmug_folder_id` to a real SmugMug id, those rows no longer
-- match the LIKE filter and stay. The placeholder photos use a
-- unique `placeholder-IMG_*` prefix that real SmugMug ImageKey
-- values can never collide with (real keys are short alphanumerics
-- like `qbSTGRd`, no underscores).
--
-- The other e2e tests (e2e_review_flow.sql, e2e_flag_review_flow.sql,
-- e2e_reviewer_stats.sql) used to reference these placeholder photo
-- ids directly; step 8.8 ports them to insert their own fixture
-- rows inside the test transaction, so this migration leaves
-- nothing for them to depend on.
--
-- Reviews on placeholder photos cascade-delete via the
-- reviews.photo_id FK (`on delete cascade`). In dev that's by design
-- (the seeded photos were throwaway); in production placeholder
-- photos almost certainly haven't been reviewed, but cascade
-- handles the edge case if they have.

delete from public.photos
  where smugmug_image_id like 'placeholder-IMG_%';

delete from public.camp_weeks
  where smugmug_folder_id like 'placeholder-week-%';

delete from public.locations
  where smugmug_folder_id like 'placeholder-location-%';
