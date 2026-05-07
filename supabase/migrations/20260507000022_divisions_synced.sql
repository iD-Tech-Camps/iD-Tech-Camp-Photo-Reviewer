-- Step 8.3a — Admin-configurable sync scope for divisions
--
-- The original 8.3 spec hardcoded "iD Tech Camps + iD Teen Academies" as
-- the in-scope subtree for photo sync. That was always going to break the
-- moment the SmugMug org changed: retired divisions sit alongside active
-- ones in the iD Tech account today, and a future hire/rename/restructure
-- shouldn't require a code deploy.
--
-- The right answer is a per-row `synced` flag on `divisions`. The folder
-- sync's discovery layer enumerates every top-level folder it sees so the
-- admin UI (step 8.5) can render the full picker; only divisions where
-- `synced = true` get walked deeply for locations + camp weeks. Default
-- is false so a brand-new SmugMug-account swap doesn't surprise-deep-walk
-- a tree we haven't vetted.
--
-- Bootstrap: the seeded "iD Tech Camps" and "iD Teen Academies" rows are
-- flipped to synced = true here so the apply step (8.3b) and the photo
-- sync (8.4) have something in scope before the admin UI lands. The two
-- non-camp divisions ("Online Private Lessons", "Virtual Tech Camps")
-- stay synced = false; they're on the org chart but not in the photo
-- pipeline.

alter table public.divisions
  add column synced boolean not null default false;

update public.divisions
  set synced = true
  where name in ('iD Tech Camps', 'iD Teen Academies');
