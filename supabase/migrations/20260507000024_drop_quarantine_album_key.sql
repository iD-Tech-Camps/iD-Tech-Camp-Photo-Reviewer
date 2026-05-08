-- Step 8.7 (revision) — Switch quarantine to Image.Hidden flag
--
-- Reframes 8.7. Migration 23 was built on the assumption that quarantine
-- meant physically moving the SmugMug image into a separate Unlisted
-- album. That turned out to be the wrong tool: SmugMug's own
-- Image.Hidden field already does exactly what we need (the image stays
-- in its camp_week album with all its existing URLs/metadata, but is
-- excluded from public album views and search).
--
-- A single PATCH /api/v2/image/<imageKey> with { Hidden: true|false }
-- is the entire SmugMug-side mechanism — no album to find-or-create,
-- no AlbumImage relationship to relocate, no URL refresh after the
-- fact (Hidden doesn't touch WebUri / ArchivedUri / ThumbnailUrl), no
-- many-to-many image/album reasoning, no idempotency probe (PATCHing
-- Hidden to its current value is a harmless no-op on SmugMug's side).
--
-- This migration drops the now-unused cache column. The
-- 'quarantine_move' sync_kind enum value stays — the audit category
-- is still meaningful and Postgres doesn't support removing enum
-- values without a full type rewrite anyway.
--
-- The route handler (/api/smugmug/quarantine), the client trigger
-- (lib/quarantine-trigger.ts), and the reconcile orchestration in
-- lib/smugmug/sync/quarantine.ts all stay in place; only the
-- SmugMug-side mechanism inside the reconcile changes.

alter table public.smugmug_config
  drop column if exists quarantine_album_key;
