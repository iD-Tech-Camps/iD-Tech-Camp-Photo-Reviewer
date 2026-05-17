# iD Tech Camp Photo Reviewer

Internal web app for **camp-week photo triage**: SmugMug sync, reviewer claims, ops-rubric flags, senior signoff. Next.js 15 + Supabase + Google OAuth (`@idtech.com`).

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

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## Roles

| Role | Access |
|------|--------|
| **Staff reviewer** | Triage hub — claim slices, clean/flag photos |
| **Senior** | Triage hub + per-week senior dashboard, signoff, positive assessments |
| **Admin** | All of the above + triage settings, locations notes, tag library, SmugMug import, app branding |

## Triage flow (summary)

1. SmugMug sync populates `photos` under `camp_weeks`.
2. **1st week** per location is derived from `triage_config` window (or admin override).
3. Reviewers open **Triage**, claim a slice (max 3 active claims), triage photos clean or with flags.
4. Tuesday sample burst prioritizes unsampled pending photos (`sampled_for_burst`).
5. When a week is done, **senior** reviews flagged photos, toggles positive rubric fields, signs off (optionally flags 2nd week for recheck).

## Database tests (local)

```bash
npx supabase db reset
npx supabase db query --file supabase/tests/e2e_smugmug_sync_flow.sql
npx supabase db query --file supabase/tests/e2e_triage_triggers.sql
```

## Crons (Vercel)

| Path | Schedule |
|------|----------|
| `/api/smugmug/sync-scheduled` | Daily 08:00 UTC |
| `/api/triage/sample-burst` | Tuesday 19:00 UTC |
| `/api/triage/sweep-claims` | Every 5 minutes |
