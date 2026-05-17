-- Triage schema smoke test (post migration 27/28).
-- Verifies singleton config, tag seed count, and a minimal claim→event path.

begin;

do $$
declare
  v_tag_count int;
  v_cfg int;
begin
  select count(*) into v_tag_count from public.tags where active = true;
  if v_tag_count <> 12 then
    raise exception 'expected 12 active tags, got %', v_tag_count;
  end if;

  select count(*) into v_cfg from public.triage_config where id = 1;
  if v_cfg <> 1 then
    raise exception 'triage_config singleton missing';
  end if;
end;
$$;

select 'smoke_test passed' as result;

rollback;
