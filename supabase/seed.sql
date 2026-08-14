-- Local-only: restore the Supabase role grants that the app and the API test
-- suite assume. Runs automatically after migrations on every `supabase db
-- reset` (config.toml → [db.seed]). Seed files are NOT applied by
-- `supabase db push`, so nothing here can reach the linked prod project.
--
-- Why this is needed
-- ------------------
-- Historically the supabase/postgres image blanket-granted DML on everything in
-- `public` to anon / authenticated / service_role, and the migrations in this
-- repo were written against that assumption — none of them issue table grants
-- of their own. Newer images (17.6.x, pulled by CLI ≥ 2.11x) no longer do that,
-- so migration-created tables come out with only REFERENCES/TRIGGER/TRUNCATE:
--
--   service_role  | REFERENCES,TRIGGER,TRUNCATE
--
-- RLS is layered on top of GRANTs, so with no SELECT grant the policies are
-- never even consulted — every request 403s with "permission denied for table
-- <x>" (42501). That breaks the whole local stack, not just the tests.
--
-- The linked prod project predates the change and already holds these grants
-- (the live app reads `profiles` fine), which is why this is a seed file rather
-- than a migration: prod needs no fix, and per CLAUDE.md prod migrations are
-- applied by hand, so a migration here would be an extra manual step that
-- changes nothing there.
--
-- Security note: this matches Supabase's own default posture. RLS remains the
-- actual boundary — every table these roles touch has RLS enabled with explicit
-- policies (migrations 9, 28, 41, 50). Granting DML does not bypass RLS.
--
-- If a future migration adds a table, it is covered automatically: the blanket
-- GRANT below runs after all migrations have applied.

-- ─── Catch-up: everything the migrations just created ────────────────────────

grant usage  on schema public to anon, authenticated, service_role;

grant all on all tables     in schema public to anon, authenticated, service_role;
grant all on all sequences  in schema public to anon, authenticated, service_role;
grant all on all routines   in schema public to anon, authenticated, service_role;

-- ─── Forward-looking: objects created after this seed runs ───────────────────
-- Scoped to the role executing this file (the same role that runs migrations),
-- so anything it creates later — e.g. tables built inside a test — inherits the
-- grants without another catch-up pass.

alter default privileges in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines  to anon, authenticated, service_role;
