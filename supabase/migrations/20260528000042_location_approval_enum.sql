-- Location approval — Phase 2 (part 1 of 2: enum value).
-- See LOCATION_APPROVAL_SPEC §3b.
--
-- Adds 'location_approved' to claim_release_reason. Standalone so the value
-- commits before the logic migration (43) parses any literal references to it.
-- Same split pattern used for senior_unflag (migrations 38/39).

alter type public.claim_release_reason add value if not exists 'location_approved';
