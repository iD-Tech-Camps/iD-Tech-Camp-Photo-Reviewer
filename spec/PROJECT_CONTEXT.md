# iD Tech Camp Photo Reviewer — Project Context

> Hand-off doc for collaborators and fresh threads. User-facing overview: [`README.md`](../README.md). Triage schema and behavior: [`TRIAGE_SPEC.md`](./TRIAGE_SPEC.md).

---

## What this app is

An internal **Camp Quality Review** tool for iD Tech. SmugMug syncs divisions, locations, camp weeks, and photos. Reviewers claim batches of photos within eligible weeks, mark them clean or flag them with ops-rubric issues. Lead reviewers review flagged work per camp week, record positive assessments, and sign off. Admins configure season bounds and review knobs (App settings), the issue library, evergreen location notes, branding, and photo sync (Photo sync screen).

> Internal naming note: code, DB columns, and migrations still use the legacy `triage_*` identifiers (table/column/route names are intentionally not renamed). User-visible copy uses **Camp Quality Review** (workflow), **Claim batch** (formerly slice), **Hide from parent view** (formerly quarantine), and **Lead reviewer** (formerly senior).

The legacy marketing-review queue (approve/flag/points/leaderboard) was removed in migration 26. Git history preserves the old design.

---

## Architecture (triage-first)

- **Primary entity:** `camp_weeks` with unified `triage_role` + `triage_state`.
- **Photo triage:** `photos.triage_state` column (not a join table). Mutations go through `SECURITY DEFINER` triggers on `triage_events` / `triage_claims` — not direct client `UPDATE` on `photos`.
- **Claims:** `triage_claims` stamp pending photos `in_progress`; max **3** active claims per reviewer.
- **Sampler:** Tuesday UTC burst marks `photos.sampled_for_burst` (fair redistribution per spec §5).
- **Quarantine:** `photos.is_quarantined` + `/api/smugmug/quarantine` (`Image.Hidden`) — unchanged from pre-refactor.
- **Signoff:** `triage_signoff_camp_week` RPC (senior/admin); can flag sibling 2nd week for recheck.

### Migrations

| Migration | Purpose |
|-----------|---------|
| `20260517000026` | Demolition — drops review tables, `photos.current_status`, etc. |
| `20260517000027` | Triage schema — enums, columns, `triage_*` tables, 12-tag seed |
| `20260517000028` | Triggers, RLS, backfill, signoff/reset RPCs |

**Dead migration slots (do not reuse):** `20260505000010`, `20260505000011`, `20260505000012` — comment-only placeholders from an abandoned gamification plan.

### RLS gotcha

Trigger functions that `UPDATE photos` must be `SECURITY DEFINER SET search_path = public`. Authenticated users have **select-only** on `photos`; the SmugMug sync job and triggers write under service role or definer context. Schema tests run as service role will not catch RLS gaps — use `e2e_*` tests that mirror client insert paths where relevant.

### Known dead writes

- **`profiles.status`** (`profile_status` enum: `active` / `idle` / `inactive`) — column and enum are kept but nothing currently writes to them; the original transition logic was tied to an obsoleted plan. `last_active_at` is the authoritative recency signal and *is* bumped by `tg_triage_events_after_insert_bump_last_active`. The `status` column is reserved for the upcoming rating-system rebuild — do not repurpose, and do not surface its value in the UI.

---

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Supabase (Postgres + Google OAuth `@idtech.com`)
- **Vercel** — team [`i-d-tech`](https://vercel.com/i-d-tech), project [`id-tech-camp-photo-reviewer`](https://vercel.com/i-d-tech/id-tech-camp-photo-reviewer); production at https://id-tech-camp-photo-reviewer.vercel.app; crons in [`vercel.json`](../vercel.json). After a project transfer, re-copy env vars (`SUPABASE_SERVICE_ROLE_KEY`, SmugMug creds, `CRON_SECRET`) — sync routes return **503** with `server_config_incomplete` when any are missing.

### Key paths

```
app/api/smugmug/     # ping, sync-folders, sync-now, sync-scheduled, quarantine
app/api/triage/      # claims, events, signoff, sample-burst, sweep-claims
components/screens/
  Triage.tsx         # hub + claim grid + senior dashboard
  Admin.tsx          # App settings (branding + triage_config season/triage)
  AdminSmugMug.tsx   # Photo sync (log + sync / sample maintenance)
  AdminLocations.tsx # evergreen notes + 1st-week override
lib/smugmug/sync/photos.ts  # orphan delete preserves triage history (§0)
spec/TRIAGE_SPEC.md  # contract for schema + triggers + UI
```

---

## Local verification

Requires Docker for `npx supabase db reset` (local stack only — **do not** `db push --linked` unless intentionally deploying).

```bash
npx supabase db reset
npx supabase db query --file supabase/tests/e2e_smugmug_sync_flow.sql
npx supabase db query --file supabase/tests/e2e_triage_triggers.sql
npm run build
```

---

## Decisions (refactor)

See [`TRIAGE_SPEC.md`](./TRIAGE_SPEC.md) §0 and [`archive/REFACTOR_INVENTORY.md`](./archive/REFACTOR_INVENTORY.md) §6 (archived planning doc). Highlights: no global photo queue; score-by-count (no leaderboard); `tags.category` for senior rollups; `triage_config` singleton separate from `app_settings` branding.
