# CLAUDE.md

Internal Camp Quality Review app: Next.js 15 + Supabase + Google OAuth. Architecture in [`spec/PROJECT_CONTEXT.md`](./spec/PROJECT_CONTEXT.md); schema/behavior contract in [`spec/TRIAGE_SPEC.md`](./spec/TRIAGE_SPEC.md). Setup, env vars, and full command detail live in [`README.md`](./README.md) — this file is the fast path for working in the repo.

## Verify before pushing

```bash
npx tsc --noEmit       # type-check
npm run lint
npm run test:unit      # pure logic, no DB
npm run test:api       # needs local Supabase: npx supabase start && npx supabase db reset
```

When a change touches the schema, triggers, or RPCs, also run the relevant SQL trigger-contract suites (each rolls back and prints a `… passed` row):

```bash
npx supabase db reset
# `supabase db query` sends the file as one prepared statement on CLI ≥ 2.11x,
# which rejects these multi-statement suites. Pipe them into psql instead:
docker exec -i supabase_db_iD_Tech_Camp_Photo_Reviewer psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/e2e_triage_triggers.sql
docker exec -i supabase_db_iD_Tech_Camp_Photo_Reviewer psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < supabase/tests/e2e_location_approval.sql
# ...other suites in supabase/tests/ as relevant
```

**Hosted Supabase rejects `UPDATE`/`DELETE` without a `WHERE` clause (pg_safeupdate), even inside triggers — local doesn't.** A bare `update public.camp_weeks set …` passes every local test and then fails in prod (this broke the season-settings save twice). Use `where true` for intentional full-table writes, and when touching triggers/functions run the safeupdate suite as the local superuser:

```bash
docker exec -i -e PGPASSWORD=postgres supabase_db_iD_Tech_Camp_Photo_Reviewer \
  psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/e2e_safeupdate_triggers.sql
```

Each suite pins the season window around `current_date` in its own rolled-back
transaction, so they pass year-round rather than only during the seeded season.

## Deploying

- **App code** auto-deploys to Vercel on push to `main`. Commit straight to `main` with a short imperative subject (matches repo history).
- **Database migrations do NOT auto-deploy** — there is no CI for the DB. Apply them by hand to the linked prod project (`idtech-photo-reviewer`, ref `xatxybwbjuusybfmwkbg`):

  ```bash
  npx supabase migration list --remote   # empty "Remote" column = pending on prod
  npx supabase db push --remote           # applies pending migrations (confirm prompt)
  ```

- For **destructive** migrations (dropping columns/functions), land + deploy the code that stops referencing the objects *before* pushing the migration, so the live app isn't running against a schema it still expects. Additive migrations are safe either order. See README → "Database migrations".

## Conventions

- DB identifiers stay `triage_*` even where user-facing copy says "Camp Quality Review."
- Migrations are sequentially numbered in `supabase/migrations/` (`YYYYMMDDxxxxNN_name.sql`); enum-value additions go in their own migration before any migration that references the new value.
