-- Step 8.7 — Quarantine folder move
--
-- The reviews_update_quarantine trigger (migration 6) already maintains
-- photos.is_quarantined: it flips to true on flag-with-quarantine and
-- back to false on senior approve/delete. What's been missing is the
-- application-side side effect — physically moving the SmugMug image
-- out of the public camp_week album into a hidden Quarantined bucket
-- so it stops showing up wherever parents/staff browse SmugMug.
--
-- 8.7 keeps that bucket as a single global Unlisted album at the
-- SmugMug user root. Discoverability of "what's quarantined" lives in
-- the Flag Review screen, not in SmugMug, so a flat global album beats
-- the alternatives (mirrored hierarchy / per-division) on every metric
-- that matters: complexity, failure surface, and the "two parallel
-- folder trees that have to stay in sync" trap.
--
-- This migration lands the two pieces the new code needs:
--
--   1. smugmug_config.quarantine_album_key — singleton cache of the
--      Quarantined album's AlbumKey, lazy-populated on first quarantine.
--      Nullable because we genuinely don't know the key until SmugMug
--      assigns it. No backfill; the first reviewer to flag-with-
--      quarantine triggers album creation under the service-role
--      route handler.
--
--   2. 'quarantine_move' on the sync_kind enum, so each move attempt
--      lands as a row in sync_log alongside scheduled / manual / mode_switch
--      / priority_add. Successes are quiet; SmugMug-side failures land
--      with status='failed' and an error_summary, surfaced on the
--      existing Admin → SmugMug → Sync log card with no UI changes.
--
-- alter type ... add value runs outside a transaction on PG 11; PG 12+
-- allows it inline as long as the new value isn't referenced in the
-- same transaction. Supabase's project is on a modern engine, so the
-- two statements coexist in one migration file without a split.

alter type sync_kind add value 'quarantine_move';

alter table public.smugmug_config
  add column quarantine_album_key text;
