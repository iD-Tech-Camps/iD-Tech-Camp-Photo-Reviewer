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
npx supabase db query --file supabase/tests/e2e_triage_triggers.sql
npx supabase db query --file supabase/tests/e2e_location_approval.sql
# ...other suites in supabase/tests/ as relevant
```

## Deploying

- **App code** auto-deploys to Vercel on push to `main`. Commit straight to `main` with a short imperative subject (matches repo history).
- **Database migrations do NOT auto-deploy** — there is no CI for the DB. Apply them by hand to the linked prod project (`idtech-photo-reviewer`, ref `xatxybwbjuusybfmwkbg`):

  ```bash
  npx supabase migration list --linked   # empty "Remote" column = pending on prod
  npx supabase db push --linked           # applies pending migrations (confirm prompt)
  ```

- For **destructive** migrations (dropping columns/functions), land + deploy the code that stops referencing the objects *before* pushing the migration, so the live app isn't running against a schema it still expects. Additive migrations are safe either order. See README → "Database migrations".

## Conventions

- DB identifiers stay `triage_*` even where user-facing copy says "Camp Quality Review."
- Migrations are sequentially numbered in `supabase/migrations/` (`YYYYMMDDxxxxNN_name.sql`); enum-value additions go in their own migration before any migration that references the new value.
