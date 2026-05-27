-- Triage schema smoke test (post migration 27/28).
-- Verifies singleton config, tag seed count, and a minimal claim→event path.

begin;

do $$
declare
  v_tag_count int;
  v_cfg int;
  v_rule_count int;
  v_ledger_start timestamptz;
  v_events_after int;
  v_ledger_after int;
begin
  -- 12 quality_flag negatives + 2 week_senior positives (great-quality-week,
  -- great-variety-week, added by migration 40).
  select count(*) into v_tag_count from public.tags where active = true;
  if v_tag_count <> 14 then
    raise exception 'expected 14 active tags, got %', v_tag_count;
  end if;

  select count(*) into v_cfg from public.triage_config where id = 1;
  if v_cfg <> 1 then
    raise exception 'triage_config singleton missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'triage_config'
      and column_name = 'season_first_week_start'
  ) then
    raise exception 'triage_config.season_first_week_start missing (run migration 31)';
  end if;

  -- Migration 32 — points rule seed + ledger invariant.
  select count(*) into v_rule_count
    from public.points_rules where source_kind = 'triage_event';
  if v_rule_count <> 1 then
    raise exception 'expected 1 points_rules row for triage_event, got %', v_rule_count;
  end if;

  -- Every clean/flag triage_event that landed after the first ledger row
  -- (= post-migration-32 events) should have exactly one ledger entry.
  -- Pre-migration-32 events are excluded by the window per spec §0.5.
  select min(occurred_at) into v_ledger_start
    from public.points_ledger where source_kind = 'triage_event';
  if v_ledger_start is not null then
    select count(*) into v_events_after
      from public.triage_events
     where kind in ('clean', 'flag')
       and created_at >= v_ledger_start;
    select count(*) into v_ledger_after
      from public.points_ledger
     where source_kind = 'triage_event'
       and occurred_at >= v_ledger_start;
    if v_events_after <> v_ledger_after then
      raise exception 'points ledger invariant: % clean/flag events vs % ledger rows after %', v_events_after, v_ledger_after, v_ledger_start;
    end if;
  end if;
end;
$$;

select 'smoke_test passed' as result;

rollback;
