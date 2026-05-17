-- Fix: saving triage_config fired tg_triage_config_after_update_recompute_all_roles,
-- which UPDATE'd all camp_weeks without a WHERE clause. Hosted Supabase rejects
-- that (SQLSTATE 21000: "UPDATE requires a WHERE clause").

create or replace function public.tg_triage_config_after_update_recompute_all_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.camp_weeks cw
  set triage_role = public.derive_camp_week_triage_role(
    cw.location_id,
    cw.starts_on,
    cw.id,
    cw.is_first_week_override,
    cw.triage_role
  )
  where true; -- intentional full-table recompute when the triage window changes

  return new;
end;
$$;
