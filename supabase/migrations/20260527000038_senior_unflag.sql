-- Lead unflag: senior approves a flagged photo (same end state as reviewer clean).
-- Part 1 of 2 — add the enum value. The function + policy that use this value
-- live in 20260527000039_senior_unflag_logic.sql so the value is committed
-- before any literal references parse (Postgres SQLSTATE 55P04 otherwise).

alter type public.triage_event_kind add value if not exists 'senior_unflag';
