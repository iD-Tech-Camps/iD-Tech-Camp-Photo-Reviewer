-- Enable Supabase Realtime broadcasts on triage_claims so the reviewer's
-- claim-batch view can subscribe to its own claim row and surface a drain
-- toast when a lead approves the location mid-batch.
-- See LOCATION_APPROVAL_SPEC §6d (Drain toast).
--
-- Safe to apply: only adds the table to the publication. Existing RLS still
-- gates which rows subscribers receive (triage_claims_select_authenticated
-- allows authenticated readers, which is what the reviewer is).

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'triage_claims'
  ) then
    alter publication supabase_realtime add table public.triage_claims;
  end if;
end;
$$;
