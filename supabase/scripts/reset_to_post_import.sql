-- Reset queue state to a "fresh after the SmugMug import" baseline.
--
-- WHAT THIS DOES:
--   * Deletes every row from review_tags + reviews (review_tags cascades from
--     reviews on delete, but we delete it explicitly first to be obvious about
--     intent).
--   * Resets every photo back to current_status = 'pending' and is_quarantined
--     = false. Photos that were flagged, approved, or deleted return to the
--     reviewer queue.
--
-- WHAT THIS DOES NOT DO:
--   * Does not touch photos.priority — admin curation (Prioritize-in-queue
--     decisions) survives.
--   * Does not touch profiles, app config (tags, points_config, bonus_periods,
--     app_settings, examples), folder hierarchy, smugmug_config, or sync_log.
--   * Does not change Image.Hidden on SmugMug. Photos that were previously
--     quarantined still have Hidden=true on SmugMug (so they don't appear in
--     public album views), even though is_quarantined is now false locally.
--     If a reviewer re-flags one with quarantine, the next per-photo
--     /api/smugmug/quarantine call will set Hidden=true again (idempotent).
--     If you want SmugMug Hidden states cleared too, do that as a separate
--     pass — there's no batch un-Hide endpoint, it's per-photoId.
--
-- All wrapped in a transaction so a partial failure is a no-op.
begin;

  delete from public.review_tags;
  delete from public.reviews;

  update public.photos
     set current_status = 'pending'::public.photo_status,
         is_quarantined = false,
         updated_at     = now()
   where current_status <> 'pending'
      or is_quarantined = true;

commit;

-- Sanity readout (counts, not assertions).
select
  (select count(*) from public.reviews)                                  as reviews_remaining,
  (select count(*) from public.review_tags)                              as review_tags_remaining,
  (select count(*) from public.photos where current_status = 'pending')  as photos_pending,
  (select count(*) from public.photos where current_status <> 'pending') as photos_not_pending,
  (select count(*) from public.photos where is_quarantined = true)       as photos_still_quarantined;
