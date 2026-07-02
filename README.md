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

## Database migrations

> ⚠️ **Migrations do not auto-deploy.** There is no CI for the database. Pushing to `main` redeploys the **app code** on Vercel, but schema changes in `supabase/migrations/` must be applied to prod **manually**. Forgetting this leaves deployed code running against an older schema.

Linked production project: **`idtech-photo-reviewer`** (ref `xatxybwbjuusybfmwkbg`). Run `npx supabase link` once if a fresh checkout isn't linked.

```bash
# 1. Apply + test locally first (resets the local DB through every migration)
npx supabase db reset

# 2. See what's pending on prod — an empty "Remote" column means not yet applied
npx supabase migration list --linked

# 3. Apply pending migrations to prod (prompts before running)
npx supabase db push --linked
```

**Sequencing with the Vercel deploy:** additive migrations are safe to push before the code. For destructive migrations (dropping columns/functions), make sure the deployed code no longer references the dropped objects first, then push the migration — otherwise the live app errors against the old schema in the gap between the two.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check (no emit) |
| `npm run test:unit` | Unit tests — pure logic, no DB |
| `npm run test:api` | API integration tests — needs the local Supabase stack |

## Roles

| Role | Access |
|------|--------|
| **Staff reviewer** | Camp Quality Review hub — claim batches, clean/flag photos |
| **Lead reviewer** | Camp Quality Review hub + per-week lead dashboard, signoff, positive assessments |
| **Admin** | All of the above + app settings (branding, season, review knobs), location notes, issue library, photo sync |

## Camp Quality Review flow (summary)

1. SmugMug sync populates `photos` under `camp_weeks`.
2. **1st week** per location is derived from `triage_config` window (or admin override).
3. Reviewers open **Camp Quality Review**, claim a batch (max 3 active claim batches), mark photos clean or flag with issues. Every pending photo at an unapproved location is in scope, newest first.
4. The **lead reviewer** works at the location level: once a location looks good for the season they **approve** it, which drains the remaining triage queue there; revoke reopens it. Leads can also mark an individual week as reviewed (audit marker) without closing the location.

## Upload alerts

A weekly check flags a location that uploaded photos last camp week but is silent this week, so a lead can chase it down. It's a **relative** signal (no per-location schedule to configure or update each year): a location is flagged only if a peer location *did* receive photos this week, which suppresses false alarms during a sync outage or holiday. Alerts appear at the top of the Lead review hub, **persist until a lead dismisses them** (they aren't auto-cleared when photos arrive), and keep a dismissed-history disclosure. Runs Wednesdays via [Vercel Cron](#crons-vercel) after the daily sync; trigger it manually with `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/alerts/weekly-upload-check`. Contract + limitations: [`spec/UPLOAD_ALERTS_SPEC.md`](./spec/UPLOAD_ALERTS_SPEC.md).

## Points & My stats

Reviewers earn points for every photo they clean or flag — both reviewer actions count, lead-only actions don&apos;t. The total appears as a chip next to the reviewer&apos;s name in the sidebar and as a today/this-week/all-time headline on the **My stats** screen, which also breaks down activity by camp week. Admins set the per-photo value on the App settings screen (integer, ≥ 0); zero records activity without awarding points. Awards accrue from migration 32 forward — earlier triage events have no ledger entries. See [`spec/GAMIFICATION_SPEC.md`](./spec/GAMIFICATION_SPEC.md) for the data model.

## Tests (local)

Three suites. Unit tests are pure logic and need nothing; the other two run against the local Supabase stack (`npx supabase start` — needs Docker).

**Unit tests** — pure functions, no database:

```bash
npm run test:unit
```

**Database trigger tests** — `psql`-style SQL files that exercise schema + triggers directly (run after `npx supabase db reset` so the local DB is current). Each file is multi-statement, which the current `supabase` CLI's `db query` rejects (`cannot insert multiple commands into a prepared statement`) — pipe them through `psql` in the DB container instead:

```bash
npx supabase db reset
DB=supabase_db_iD_Tech_Camp_Photo_Reviewer   # container name from `docker ps`
for f in smugmug_sync_flow triage_triggers location_approval photo_rating_triggers points_award upload_alerts; do
  docker exec -i "$DB" psql -U postgres -d postgres < "supabase/tests/e2e_$f.sql"
done
docker exec -i "$DB" psql -U postgres -d postgres < supabase/tests/smoke_test.sql
```

Each file wraps its scenarios in a transaction and `ROLLBACK`s at the end, printing a `… passed` row on success (it raises and aborts on the first failed assertion).

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
| `/api/alerts/weekly-upload-check` | Wednesdays 10:00 UTC (after the daily sync) |
| `/api/triage/sweep-claims` | Every 5 minutes |
