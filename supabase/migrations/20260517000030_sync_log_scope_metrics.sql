-- Scope metrics for photo sync audit rows (weeks scanned + images seen on SmugMug).

alter table public.sync_log
  add column if not exists weeks_in_scope int,
  add column if not exists images_seen int;
