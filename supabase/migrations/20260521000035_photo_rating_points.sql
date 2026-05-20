-- Award points for photo_rating_events (same ledger as triage).
-- Postgres requires the new enum value to commit before use — see 36.

alter type public.points_source add value if not exists 'photo_rating_event';
