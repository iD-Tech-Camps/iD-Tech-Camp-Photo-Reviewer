# iD Tech Camp Photo Reviewer — Project Context

> Hand-off doc for collaborators and fresh threads. User-facing overview: [`README.md`](../README.md). Triage schema and behavior: [`TRIAGE_SPEC.md`](./TRIAGE_SPEC.md).

---

## What this app is

An internal **camp-week triage** tool for iD Tech. SmugMug syncs divisions, locations, camp weeks, and photos. Reviewers claim slices of photos within eligible weeks, mark them clean or flag them with ops-rubric tags. Seniors review flagged work per camp week, record positive assessments, and sign off. Admins configure yearly triage windows, tags, evergreen location notes, branding, and SmugMug import.

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

---

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Supabase (Postgres + Google OAuth `@idtech.com`)
- Vercel hosting + crons (`vercel.json`)

### Key paths

```
app/api/smugmug/     # ping, sync-folders, sync-now, sync-scheduled, quarantine
app/api/triage/      # claims, events, signoff, sample-burst, sweep-claims
components/screens/
  Triage.tsx         # hub + claim grid + senior dashboard
  AdminTriage.tsx    # yearly triage_config
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

See [`TRIAGE_SPEC.md`](./TRIAGE_SPEC.md) §0 and [`REFACTOR_INVENTORY.md`](./REFACTOR_INVENTORY.md) §6. Highlights: no global photo queue; score-by-count (no leaderboard); `tags.category` for senior rollups; `triage_config` singleton separate from `app_settings` branding.
