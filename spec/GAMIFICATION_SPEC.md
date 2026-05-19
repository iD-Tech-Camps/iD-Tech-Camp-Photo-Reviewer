# Gamification Spec — V1 (Triage Points)

## 0. Framing

V1 scope: a per-reviewer points total. Reviewers see their own; admins see everyone's. Points come from triage events today, but the data model is source-agnostic so a future surface (the planned ratings interface) can plug into the same ledger without a schema rewrite.

**Adopted decisions:**

| § | Decision | Reasoning |
|---|---|---|
| 0.1 | Reaffirm TRIAGE_SPEC §6.7 — **no leaderboard**. Reviewer sees own total only; admin sees all. | Brief stance unchanged; ranked competitive surface isn't wanted yet. |
| 0.2 | Source-agnostic ledger keyed by `(source_kind, source_id)`. Today only `'triage_event'` is populated. | The whole point of doing this now is to not retrofit later. Cost is two columns and an enum. |
| 0.3 | One admin knob in V1: integer points per completed photo, applied uniformly to `clean` and `flag` reviewer events. Senior kinds earn nothing. | "Reviewer reviewed a photo" is the unit. Per-action and per-tag granularity deferred. |
| 0.4 | Ledger row snapshots `points` at insert time. Later config changes don't rewrite history. | Matches the old `reviews.points_awarded` principle; keeps the ledger an immutable audit log. |
| 0.5 | No backfill of pre-migration-32 `triage_events`. Points accrue from the day the trigger lands. | Avoids a one-shot DML inside the schema migration; says so in `README.md` near release time. |
| 0.6 | `points >= 0` allowed; trigger always inserts even when the configured value is 0. | "0 points" is a deliberate admin choice (record activity, award nothing) — not a disable. Keeps the "one ledger row per clean/flag event" invariant unconditional. |
| 0.7 | Deferred from V1: streaks, badges, leaderboard, bonus multipliers, per-tag bonuses, per-action point variation, the ratings-system source. | Each is additive (new enum values, new triggers, new tables) — no V1 choice constrains them. |

---

## 1. Schema

### 1a. New enum

```sql
create type public.points_source as enum ('triage_event');
```

Add `'review'` (or whatever the ratings system names itself) when that source lands. Enum value additions are append-only.

### 1b. New tables

```sql
create table public.points_rules (
  source_kind  public.points_source primary key,
  points       int not null check (points >= 0),
  updated_at   timestamptz not null default now()
);

create table public.points_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  source_kind  public.points_source not null,
  source_id    uuid not null,
  points       int not null check (points >= 0),
  occurred_at  timestamptz not null default now()
);

create index points_ledger_user_idx
  on public.points_ledger (user_id, occurred_at desc);

create index points_ledger_source_idx
  on public.points_ledger (source_kind, source_id);
```

Notes:

- `points_ledger.source_id` has **no FK**. Different `source_kind`s reference different tables; Postgres has no native polymorphic FK. Integrity is enforced at the trigger.
- `on delete restrict` on `user_id` matches the project's convention for attribution columns (same as `triage_events.reviewer_id`).
- No `(source_kind, source_id)` uniqueness constraint — leaves room for a future event type to award multiple ledger rows per source row. The triage trigger inserts exactly one per event regardless.
- No cascade from `triage_events` to ledger. If a `triage_events` row is removed in some future migration, its ledger entry survives as audit. (Currently `triage_events` has no `DELETE` policy and isn't expected to be deleted.)

### 1c. View

```sql
create or replace view public.user_points_totals as
select
  user_id,
  count(*)::int as event_count,
  coalesce(sum(points), 0)::int as total_points
from public.points_ledger
group by user_id;
```

Feeds both the reviewer sidebar chip and the admin Overview column. All-time totals — no time window. Windowed aggregates can come later if useful.

### 1d. Seed

```sql
insert into public.points_rules (source_kind, points) values ('triage_event', 1);
```

One point per completed photo as a defensible default; admin can change it immediately after deploy.

---

## 2. Trigger

`tg_triage_events_after_insert_award_points` — `after insert on triage_events`, `SECURITY DEFINER SET search_path = public`.

Logic:

1. Filter: fire only when `NEW.kind in ('clean', 'flag')`. Senior kinds (`senior_delete`, `senior_quarantine`, `senior_release_quarantine`) are ignored.
2. Look up the active points value: `select points from points_rules where source_kind = 'triage_event'`.
3. If the rule row is missing (shouldn't happen post-seed), no-op and `raise warning` — this is a misconfiguration, not a normal path. If `points = 0`, still insert (per §0.6).
4. Insert `(user_id := NEW.reviewer_id, source_kind := 'triage_event', source_id := NEW.id, points := <looked-up>, occurred_at := NEW.created_at)`.

`SECURITY DEFINER` rationale: same as TRIAGE_SPEC §4 — authenticated clients have no write access to `points_ledger`; the trigger runs as the definer role to write.

---

## 3. RLS

Default deny on both new tables.

**`points_rules`:**

- `select`: authenticated.
- `update`: `is_admin()`.
- `insert / delete`: nobody (seed handles the initial row; new rows arrive with new enum values via future migrations).

**`points_ledger`:**

- `select`: `user_id = auth.uid()` OR `is_admin()`.
- `insert / update / delete`: nobody via policies — only the SECURITY DEFINER trigger writes.

**View `user_points_totals`:** Postgres views default to invoker-rights, so reviewers see only their own aggregated row and admins see all. This matches both surfaces' needs.

---

## 4. API routes

| Path | Method | Role | Purpose |
|---|---|---|---|
| `/api/admin/points-rules` | PUT | admin | Body: `{ source_kind: 'triage_event', points: number }`. Updates the rule and stamps `updated_at`. |

No GET — the App settings screen reads from Supabase directly, matching how other settings load.

No reviewer-facing endpoint — the sidebar chip reads `user_points_totals` directly.

---

## 5. UI surfaces

### 5a. Reviewer — sidebar chip

A small "N pts" chip in [`components/Shell.tsx`](../components/Shell.tsx) next to the avatar/name block. Reads `user_points_totals` for the current user. Refreshes on navigation; no live subscription. Hide (don't render the chip) when loading; show "0 pts" when the user has zero events.

No new screen. Profile slot remains deferred per TRIAGE_SPEC §7.

### 5b. Admin — Overview column

Add a Points column to the admin Overview roster (table in `components/screens/Admin.tsx` under `AdminOverview`). Joined from `user_points_totals` on `profiles.id`. Sortable. Surface `event_count` too if column space allows, or in the edit modal.

### 5c. Admin — App settings field

One field on the App settings screen (also in `Admin.tsx` under `AdminSettings`): "Points per completed photo" — integer input, ≥ 0. Persists via the new PUT endpoint. Help text: *"Awarded once per photo a reviewer marks clean or flags. Set to 0 to record activity without awarding points."*

---

## 6. Migration ordering

**Migration 32 — `20260519000032_gamification_v1.sql`**

1. Create enum `points_source`.
2. Create `points_rules`.
3. Create `points_ledger` + indexes.
4. Create view `user_points_totals`.
5. Create trigger function + attach to `triage_events`.
6. RLS policies on both tables.
7. Seed `('triage_event', 1)`.

Application layer (same delivery chunk):

1. `/api/admin/points-rules` route.
2. Shell chip + admin Overview column + App settings field.
3. Tests (§7).

> The original draft of this spec referred to the migration as "29". By the time the schema landed, migrations 29–31 had been filled by the triage refactor follow-ups, so the gamification migration ships as 32. The migration suffix is the only thing that changed — every other §0.5 / §7 reference to "migration 29" should be read as "migration 32".

---

## 7. Testing

**`supabase/tests/e2e_points_award.sql`** — new e2e:

1. Insert a reviewer profile + a minimal `triage_events` precondition (photo, camp_week, etc., via existing fixture helpers).
2. Insert a `triage_events` row with `kind = 'clean'`. Assert exactly one `points_ledger` row exists with matching `source_id`, `user_id`, `points` equal to the seeded rule, and `occurred_at` equal to the event's `created_at`.
3. Insert a `triage_events` row with `kind = 'senior_delete'` for the same user. Assert ledger count is still 1 (senior kinds don't award).
4. Update the rule to 5. Insert another `clean`. Assert the new ledger row has `points = 5` and the previous row's `points` is unchanged (snapshot principle).
5. Update the rule to 0. Insert another `clean`. Assert a third ledger row exists with `points = 0` (per §0.6).

**Smoke-test invariant** — extend `supabase/tests/smoke_test.sql`: count `triage_events` where `kind in ('clean', 'flag')` and `created_at >= (select min(occurred_at) from points_ledger where source_kind = 'triage_event')`; count matching ledger rows; assert equal. This window-bounds the assertion to events that *should* have ledger entries (pre-migration-32 events won't, per §0.5).

**Vitest** — `tests/api/points-rules.test.ts` covers the route handler (auth gating, validation, persistence) and exercises the trigger end-to-end against the local Supabase stack.

---

## 8. PROJECT_CONTEXT.md updates

Three edits:

1. Add a row to the Migrations table for `20260519000032`.
2. Reword the dead-slots line to point readers at this spec.
3. Add a one-line cross-reference under Architecture.

---

## 9. Execution note

Implementation follows this spec. `spec/GAMIFICATION_SPEC.md` is the source of truth; amend via PR if scope shifts.
