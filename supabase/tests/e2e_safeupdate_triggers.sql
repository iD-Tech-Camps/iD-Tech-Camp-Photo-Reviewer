-- Safeupdate contract: hosted Supabase loads pg_safeupdate, which rejects any
-- UPDATE/DELETE without a WHERE clause — including ones inside triggers and
-- functions. Local Supabase doesn't load it, so a WHERE-less statement passes
-- every other suite and then fails in production (it happened twice to the
-- triage_config season-window trigger; see migrations 29 and 55).
--
-- This suite loads safeupdate and exercises the code paths that update many
-- rows. Loading the library needs the local superuser, so run it as
-- supabase_admin (local password "postgres"):
--
--   docker exec -i -e PGPASSWORD=postgres supabase_db_iD_Tech_Camp_Photo_Reviewer \
--     psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/e2e_safeupdate_triggers.sql
--
-- Everything runs in one transaction and is rolled back.

load 'safeupdate';

begin;

-- Saving the season window fires the full role recompute.
update public.triage_config
   set season_first_week_start = season_first_week_start - 7,
       season_last_week_start  = season_last_week_start + 7
 where id = 1;

-- The post-sync recompute, called directly.
select public.recompute_all_triage_roles();

select 'e2e safeupdate triggers passed' as result;

rollback;
