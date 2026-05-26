-- Must commit before later_week is usable in functions/DML (Postgres enum rule).
alter type public.camp_week_triage_role add value if not exists 'later_week';
