# iD Tech Camp Photo Reviewer

Internal web app for **camp-week Camp Quality Review**: SmugMug sync, reviewer claim batches, ops-rubric flags, lead signoff. Next.js 15 + Supabase + Google OAuth (`@idtech.com`).

Architecture and roadmap: [`spec/PROJECT_CONTEXT.md`](./spec/PROJECT_CONTEXT.md). Schema and behavior contract: [`spec/TRIAGE_SPEC.md`](./spec/TRIAGE_SPEC.md).

## Getting started

```bash
npm install
cp .env.example .env.local   # if you use an example file
npm run dev
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. For cron routes locally, set `CRON_SECRET` to match Vercel.

## Deployment (Vercel)

| | |
|---|---|
| Team / project | [`i-d-tech` / `id-tech-camp-photo-reviewer`](https://vercel.com/i-d-tech/id-tech-camp-photo-reviewer) |
| Production branch | `main` (auto-deploy on push when Git is connected) |
| Production URL | https://id-tech-camp-photo-reviewer.vercel.app |

CLI link (from repo root): `npx vercel link` → team **i-d-tech**, project **id-tech-camp-photo-reviewer**. Production deploy: `npx vercel --prod`.

**Environment variables (Vercel → Settings → Environment Variables):** after a project transfer, copy all secrets from the old project. Photo sync and crons need at least:

| Variable | Used by |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | App + API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App + API |
| `SUPABASE_SERVICE_ROLE_KEY` | Sync, quarantine, crons (server-only) |
| `SMUGMUG_API_KEY` / `SMUGMUG_API_SECRET` | SmugMug OAuth |
| `SMUGMUG_ACCESS_TOKEN` / `SMUGMUG_ACCESS_TOKEN_SECRET` | SmugMug OAuth |
| `CRON_SECRET` | Scheduled sync + triage crons |

If **Sync now** returns 500 or 503 with `server_config_incomplete`, one or more of the rows above is missing on the deployment.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## Roles

| Role | Access |
|------|--------|
| **Staff reviewer** | Camp Quality Review hub — claim batches, clean/flag photos |
| **Lead reviewer** | Camp Quality Review hub + per-week lead dashboard, signoff, positive assessments |
| **Admin** | All of the above + app settings (branding, season, review knobs), location notes, issue library, photo sync |

## Camp Quality Review flow (summary)

1. SmugMug sync populates `photos` under `camp_weeks`.
2. **1st week** per location is derived from `triage_config` window (or admin override).
3. Reviewers open **Camp Quality Review**, claim a batch (max 3 active claim batches), mark photos clean or flag with issues.
4. Tuesday sample pull prioritizes unsampled pending photos (`sampled_for_burst`).
5. When a week is done, the **lead reviewer** reviews flagged photos, toggles positive rubric fields, signs off (optionally flags 2nd week for follow-up review).

## Tests (local)

Both suites run against the local Supabase stack (`npx supabase start` — needs Docker).

**Database trigger tests** — `psql`-style SQL files that exercise schema + triggers directly:

```bash
npx supabase db reset
npx supabase db query --file supabase/tests/e2e_smugmug_sync_flow.sql
npx supabase db query --file supabase/tests/e2e_triage_triggers.sql
npx supabase db query --file supabase/tests/smoke_test.sql
```

**API integration tests** — Vitest invokes each Next.js route handler with a fake `Request`, mocks `lib/api-auth.ts` for auth/role injection, and asserts both the HTTP response and the DB state after each call. Covers happy path + auth-rejection + input-validation path per route under `app/api/triage/*`.

```bash
cp .env.test.local.example .env.test.local
# fill in the values shown by `npx supabase status` (URL + anon + service-role keys)

npm run test:api
```

The harness refuses to run against a non-local Supabase URL — fixture seeding creates and deletes auth users, divisions, and camp weeks, which would be destructive against production.

## Crons (Vercel)

| Path | Schedule |
|------|----------|
| `/api/smugmug/sync-scheduled` | Daily 08:00 UTC |
| `/api/triage/sample-burst` | Tuesday 19:00 UTC |
| `/api/triage/sweep-claims` | Every 5 minutes |
