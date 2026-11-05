-- Fix (again): saving the season window in Admin → settings failed on hosted
-- Supabase with "UPDATE requires a WHERE clause" (pg_safeupdate, SQLSTATE
-- 21000). Migration 29 fixed this once by adding `where true`; migration 37
-- rewrote tg_triage_config_after_update_recompute_all_roles() to set both
-- triage_role and rating_role and dropped the WHERE clauses again. Local
-- Supabase doesn't load safeupdate, so tests didn't notice.
--
-- Delegate to recompute_all_triage_roles() (migration 49), which the nightly
-- sync already runs. It has WHERE clauses and only writes weeks whose role
-- actually changes — so settled/approved weeks aren't rewritten (and their
-- role-fanout trigger doesn't fire) just because the window moved.
--
-- Regression check: supabase/tests/e2e_safeupdate_triggers.sql (runs with
-- safeupdate loaded, as on hosted).

create or replace function public.tg_triage_config_after_update_recompute_all_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_all_triage_roles();
  return new;
end;
$$;
