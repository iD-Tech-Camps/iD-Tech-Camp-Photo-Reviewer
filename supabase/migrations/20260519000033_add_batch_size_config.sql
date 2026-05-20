-- Add `batch_size` to triage_config so admins can size reviewer batches.
--
-- Distinct from `max_for_triage_per_burst`, which remains the budget for the
-- scheduled sample-burst cron (still wired via /api/triage/sample-burst).
-- This new field caps the photo count returned by the "Start a batch" path
-- in the review hub; "Whole week" still pulls all pending photos in a week.
--
-- Default 50 is a reasonable session length for a reviewer to complete
-- without releasing or being swept by the claim-expiry timer.

alter table public.triage_config
  add column batch_size int not null default 50
    check (batch_size > 0);
