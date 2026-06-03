# iD Tech Camp Photo Reviewer — Project Context

> Hand-off doc for collaborators and fresh threads. User-facing overview: [`README.md`](../README.md). Triage schema and behavior: [`TRIAGE_SPEC.md`](./TRIAGE_SPEC.md). Per-location approval (replaces per-week signoff): [`LOCATION_APPROVAL_SPEC.md`](./LOCATION_APPROVAL_SPEC.md).

---

## What this app is

An internal review tool for iD Tech with two reviewer workflows:

- **Camp Quality Review** — flag ops issues on photos (triage).
- **Camp Photo Review** — 1–5 star ratings with optional tags and quarantine.

SmugMug syncs divisions, locations, camp weeks, and photos. Lead reviewers sign off quality review per camp week and apply week-level assessment tags. Admins configure season bounds, tag libraries, location notes, branding, and photo sync.

> Internal naming note: code, DB columns, and migrations still use the legacy `triage_*` identifiers (table/column/route names are intentionally not renamed). User-visible copy uses **Camp Quality Review** (workflow), **Claim batch** (formerly slice), **Hide from parent view** (formerly quarantine), and **Lead reviewer** (formerly senior).

The legacy marketing-review queue (approve/flag/points/leaderboard) was removed in migration 26. Git history preserves the old design.

---

## Architecture (triage-first)

- **Primary entity:** `camp_weeks` with unified `triage_role` + `triage_state`. `camp_weeks` carry triage state and photos; **approval lives on `locations`** (per season, see [`LOCATION_APPROVAL_SPEC.md`](./LOCATION_APPROVAL_SPEC.md)).
- **Photo triage:** `photos.triage_state` column (not a join table). Mutations go through `SECURITY DEFINER` triggers on `triage_events` / `triage_claims` — not direct client `UPDATE` on `photos`.
- **Claims:** `triage_claims` stamp pending photos `in_progress`; max **3** active claims per reviewer.
- **Sampler:** **Removed in phase 4** of the location-approval refactor (the legacy Tuesday `sampled_for_burst` burst). The new model has no queue to sample — every pending photo at an unapproved location is in scope, ordered newest-first.
- **Quarantine:** `photos.is_quarantined` + `/api/smugmug/quarantine` (`Image.Hidden`) — unchanged from pre-refactor.
- **Approval (post location-approval refactor):** `location_approvals` row per `(location_id, season_start)`; approve drains in-flight triage at that location, revoke reopens. The `triage_signoff_camp_week` RPC is retained as the per-week "Mark week as reviewed" audit marker (`camp_weeks.signoff_at`/`signoff_by`), decoupled from approval. The `camp_weeks.triage_state` values `senior_review` and `complete` are no longer assigned by triggers (enum values retained for historical rows). See [`LOCATION_APPROVAL_SPEC.md`](./LOCATION_APPROVAL_SPEC.md).
- **Photo rating:** `photos.rating_state` + `photo_rating_claims` / `photo_rating_events` — see [`PHOTO_RATING_SPEC.md`](./PHOTO_RATING_SPEC.md). Untouched by the location-approval refactor.
- **Gamification:** points layer on top of triage via a source-agnostic ledger — see [`GAMIFICATION_SPEC.md`](./GAMIFICATION_SPEC.md).

### Migrations

| Migration | Purpose |
|-----------|---------|
| `20260517000026` | Demolition — drops review tables, `photos.current_status`, etc. |
| `20260517000027` | Triage schema — enums, columns, `triage_*` tables, 12-tag seed |
| `20260517000028` | Triggers, RLS, backfill, signoff/reset RPCs |
| `20260519000032` | Gamification V1 — points ledger + rules + trigger on triage_events |
| `20260520000034` | Photo rating — parallel workflow + `tags.purposes` + week senior tags |
| `20260527000041` | Location approval — schema (`location_approvals`, `location_feedback_events`, view, RPC, backfill). Non-breaking. |
| `20260528000042` | Location approval — `claim_release_reason` enum value `'location_approved'`. Standalone so the value commits before the logic migration parses. |
| `20260528000043` | Location approval — triggers swap: drain on approve, reopen on revoke, drop legacy signoff side-effects. |
| `20260603000047` | Photo Library — `photos.current_rating` (denormalized latest star rating) + index + rating-event trigger update + backfill. Additive. |
| `20260603000048` | `locations.is_ignored` + `set_location_ignored` RPC (senior/admin) + recreate `locations_with_approval` view. Hides a location from every review hub + the Photo Library. Additive. |

**Dead migration slots (do not reuse):** `20260505000010`, `20260505000011`, `20260505000012` — comment-only placeholders. Gamification was deferred during the triage refactor; V1 (points only) ships under migration 32 — see [`GAMIFICATION_SPEC.md`](./GAMIFICATION_SPEC.md). The slots stay dead — future gamification work (streaks, badges, etc.) uses new migration numbers.

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
app/api/triage/      # claims, events (grace window post-refactor), signoff (per-week review marker), sweep-claims
app/api/locations/[id]/  # approve, revoke, feedback — post location-approval refactor
app/api/photo-rating/  # claims, events, week-tags, sweep-claims
components/screens/
  Triage.tsx         # Camp Quality Review hub + claim grid + senior dashboard
  PhotoRating.tsx    # Camp Photo Review hub + star-rating lightbox
  PhotoGallery.tsx   # Photo Library — browse/filter/download rated photos (marketing)
  Admin.tsx          # App settings (branding + triage_config season/triage)
  AdminSmugMug.tsx   # Photo sync (log + sync / sample maintenance)
  AdminLocations.tsx # evergreen notes + 1st-week override
lib/smugmug/sync/photos.ts  # orphan delete preserves triage history (§0)
spec/TRIAGE_SPEC.md  # contract for schema + triggers + UI
spec/LOCATION_APPROVAL_SPEC.md  # per-location approval lifecycle + drain/reopen contract
```

---

## Local verification

Requires Docker for `npx supabase db reset` (local stack only — **do not** `db push --linked` unless intentionally deploying).

```bash
npx supabase db reset
npx supabase db query --file supabase/tests/e2e_smugmug_sync_flow.sql
npx supabase db query --file supabase/tests/e2e_triage_triggers.sql
npx supabase db query --file supabase/tests/e2e_photo_rating_triggers.sql
npm run build
```

---

## Decisions (refactor)

See [`TRIAGE_SPEC.md`](./TRIAGE_SPEC.md) §0 and [`archive/REFACTOR_INVENTORY.md`](./archive/REFACTOR_INVENTORY.md) §6 (archived planning doc). Highlights: no global photo queue; score-by-count (no leaderboard); `tags.category` for senior rollups; `triage_config` singleton separate from `app_settings` branding.
