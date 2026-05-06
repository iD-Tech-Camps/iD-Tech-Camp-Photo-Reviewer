# iD Photo Reviewer — Database Schema Spec (Step 5)

> **Status: implemented.** This document was originally the brief for step 5 and is now the reference for what's actually in the database. The schema lives in `supabase/migrations/20260505000001_*.sql` through `supabase/migrations/20260505000012_*.sql`, applied to the work-account Supabase project (`idtech-photo-reviewer`). The few places where the implementation diverges from the original brief are called out inline with **`Implementation note`** blocks.

---

## What this schema needs to support

The app has two operating purposes that share one data model:

1. **Public-facing pipeline.** Reviewers triage photos uploaded to SmugMug by camp directors, marking them `approve` (great for parents) or `flag` (a senior should look). Photos are public by default; the only time a flag affects parent visibility is when the reviewer explicitly checks "quarantine" on a flag — in which case the photo moves to a hidden SmugMug folder until a senior resolves it.
2. **Internal QA pipeline.** During the camp week (typically Tuesdays), senior reviewers look at incoming photos to spot brand/setup/safety issues. They use the same flag mechanism as everyone else; tags like `off-brand` route notifications to the right specialist senior. Acting on the underlying ops issue happens outside this app.

There are three roles: `reviewer` (default), `senior`, and `admin`. Seniors do everything reviewers do plus they can resolve flags by approving (re-rating, re-tagging) or deleting. Admins additionally manage tags, examples, points, routing rules, and app settings.

---

## Relationship map at a glance

```
auth.users ──1:1── profiles
                      │
                      │ reviewer_id
                      ▼
divisions ──1:N── locations ──1:N── camp_weeks ──1:N── photos ──1:N── reviews ──N:M── tags
                                                                          │
                                                                          ▼
                                                                     review_tags

senior_routing_rules ─── tag_triggers (text[]) → references tag ids
                     └── recipient_id → profiles

points_config         (single-row config table)
app_settings          (single-row config table)
examples              (admin-managed example library)
```

---

## Enums (define first)

```sql
create type decision      as enum ('approve', 'flag', 'delete');
create type role          as enum ('reviewer', 'senior', 'admin');
create type profile_status as enum ('active', 'idle', 'inactive');
create type tag_kind      as enum ('positive', 'negative');
create type photo_status  as enum ('pending', 'approved', 'flagged', 'deleted');
create type example_kind  as enum ('good', 'bad');
```

Notes:
- `photo_status` is the photo's *workflow* state. Visibility (`is_quarantined`) is a separate dimension — a `flagged` photo may or may not be quarantined.
- `decision` covers all three actions a person can take on a photo. There is no separate "accept" decision; a senior bringing a flagged photo back is just performing `approve` (with rating + tags, same as any reviewer).

---

## Folder hierarchy (mirrors SmugMug, kept in sync via import job)

### `divisions`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `name` | text not null | e.g. "Game Dev" |
| `smugmug_folder_id` | text not null unique | the SmugMug node id |
| `created_at` | timestamptz | `default now()` |

### `locations`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `division_id` | uuid not null | fk → `divisions(id)` on delete cascade |
| `name` | text not null | e.g. "Stanford University, Palo Alto CA" |
| `smugmug_folder_id` | text not null unique | |
| `created_at` | timestamptz | |

### `camp_weeks`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `location_id` | uuid not null | fk → `locations(id)` on delete cascade |
| `name` | text not null | e.g. "Week 3" |
| `smugmug_folder_id` | text not null unique | |
| `starts_on` | date not null | |
| `ends_on` | date not null | |
| `created_at` | timestamptz | |

Index `camp_weeks_dates_idx` on `(starts_on, ends_on)` for date-range queries.

> **Implementation note.** The original brief had an `is_active` stored generated column defined as `current_date between starts_on and ends_on`. Postgres requires stored generated columns to use `IMMUTABLE` expressions and `current_date` is `STABLE` (it shifts with the session's transaction timestamp), so the column was rejected by the remote with `SQLSTATE 42P17`. To preserve the spec's intent without changing the column shape conceptually, the table exposes the boolean through a view:
>
> ```sql
> create view public.camp_weeks_with_status as
>   select *, (current_date between starts_on and ends_on) as is_active
>     from public.camp_weeks;
> ```
>
> App code reads `camp_weeks_with_status` whenever it wants the boolean. Writes still go to the base table.

---

## Photos

### `photos`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `camp_week_id` | uuid not null | fk → `camp_weeks(id)` on delete restrict |
| `smugmug_image_id` | text not null unique | dedupe key on import |
| `smugmug_url` | text | link to SmugMug page |
| `image_url` | text | full-resolution URL |
| `thumbnail_url` | text | smaller URL for grid views |
| `caption` | text | from SmugMug; replaces the prototype's `activity` field |
| `captured_at` | timestamptz | |
| `width` | int | |
| `height` | int | |
| `current_status` | photo_status not null | `default 'pending'` — maintained by trigger |
| `is_quarantined` | bool not null | `default false` — maintained by trigger |
| `smugmug_folder_id` | text | which SmugMug folder it's currently in (public week folder OR hidden quarantine folder) |
| `created_at` | timestamptz | `default now()` |
| `updated_at` | timestamptz | `default now()` |

Index on `(current_status, camp_week_id)` for the reviewer queue.
Index on `(is_quarantined)` for the senior's "quarantined queue" view.

---

## Reviews — the immutable decision log

### `reviews`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `photo_id` | uuid not null | fk → `photos(id)` on delete cascade |
| `reviewer_id` | uuid not null | fk → `profiles(id)` on delete restrict |
| `decision` | decision not null | |
| `rating` | smallint | 1–5; only set when `decision = 'approve'` |
| `note` | text | optional; mainly used on flags |
| `quarantine` | bool not null | `default false` — only meaningful when `decision = 'flag'` |
| `points_awarded` | int not null | `default 0` — snapshotted from `points_config` at insert time so future rate changes don't rewrite history |
| `created_at` | timestamptz | `default now()` |

Constraints:
- `check (decision = 'approve' or rating is null)` — rating only on approves
- `check (decision = 'flag' or quarantine = false)` — quarantine only on flags

Index on `(photo_id, created_at desc)` so "the latest review for this photo" is fast.
Index on `(reviewer_id, created_at desc)` for profile/leaderboard queries.

### `review_tags`
| col | type | notes |
|---|---|---|
| `review_id` | uuid not null | fk → `reviews(id)` on delete cascade |
| `tag_id` | text not null | fk → `tags(id)` on delete restrict |
| pk | (review_id, tag_id) | |

---

## Tags

### `tags`
| col | type | notes |
|---|---|---|
| `id` | text pk | slug-style; keep the existing ones from `data.tsx` (`blurry`, `hero-shot`, `off-brand`, etc.) |
| `label` | text not null | display name |
| `kind` | tag_kind not null | positive (used on approves) or negative (used on flags) |
| `display_order` | int not null | `default 0` |
| `active` | bool not null | `default true` |
| `created_at` | timestamptz | |

Seed this table from the tag lists in `components/data.tsx`.

> **Implementation note.** There is no `POSITIVE_TAGS` export. `data.tsx` exports `NEGATIVE_TAGS` (13 entries — the canonical flag-tag list) and `PHOTO_TAGS` (a mixed list with 4 positive entries and 7 deprecated negative duplicates). The 4 positive tags (`great-moment`, `hero-shot`, `group-energy`, `caption-worthy`) are derived locally inside `ReviewScreen.tsx` via `PHOTO_TAGS.filter(t => t.color !== "rose")`. Migration `20260505000004_tags.sql` seeds the 13 negatives verbatim and those 4 positives; the 7 rose duplicates in `PHOTO_TAGS` are intentionally not seeded.

---

## Profiles

### `profiles`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | fk → `auth.users(id)` on delete cascade |
| `email` | text not null | |
| `full_name` | text | from Google profile |
| `role` | role not null | `default 'reviewer'` |
| `team` | text | Operations / Programs / Marketing / Support / etc. |
| `status` | profile_status not null | `default 'active'` |
| `created_at` | timestamptz | `default now()` |
| `last_active_at` | timestamptz | `default now()` — bumped on every review insert |

Auto-create a `profiles` row on every `auth.users` insert via a trigger (standard Supabase pattern).

---

## Routing rules

### `senior_routing_rules`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | admin-friendly label, e.g. "Safety escalation" |
| `recipient_id` | uuid not null | fk → `profiles(id)` — the senior who gets the ping |
| `tag_triggers` | text[] not null | array of `tags.id`; rule fires when any flag has any of these tags |
| `channels` | text[] not null | subset of `{'email', 'slack', 'sms', 'inapp'}` |
| `active` | bool not null | `default true` |
| `created_at` | timestamptz | |

This table is read by the app on flag insert to decide who to notify. The actual sending of email/Slack/etc. is application-layer concern, not in scope for the schema.

---

## Configuration tables

### `points_config` (single-row)
Enforce single row with `id smallint pk default 1 check (id = 1)`.

| col | type | notes |
|---|---|---|
| `id` | smallint pk | always 1 |
| `approve_points` | int not null | `default 10` |
| `flag_points` | int not null | `default 15` |
| `delete_points` | int not null | `default 0` |
| `updated_at` | timestamptz | |

### `app_settings` (single-row)
Same single-row pattern.

| col | type | notes |
|---|---|---|
| `id` | smallint pk | always 1 |
| `brand_mark` | text | currently in `SettingsProvider` |
| `brand_name` | text | |
| `brand_tagline` | text | |
| `show_leaderboard` | bool not null | `default true` |
| `updated_at` | timestamptz | |

### `examples`
| col | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `kind` | example_kind not null | good / bad |
| `label` | text not null | |
| `note` | text | |
| `image_url` | text | optional reference image |
| `display_order` | int not null | `default 0` |
| `active` | bool not null | `default true` |
| `created_at` | timestamptz | |

Seed from the `EXAMPLES` constant in `components/data.tsx`.

---

## Triggers (described; Cursor implements)

1. **`profiles` auto-creation on `auth.users` insert.** Standard Supabase pattern — copies `id`, `email`, and `full_name` (from `raw_user_meta_data`) into `profiles` with default role `reviewer`.

2. **Maintain `photos.current_status` on `reviews` insert.**
   - `approve` → `'approved'`
   - `flag` → `'flagged'`
   - `delete` → `'deleted'`
   Also bump `photos.updated_at`.

3. **Maintain `photos.is_quarantined` on `reviews` insert.**
   - If `decision = 'flag'` and `quarantine = true` → set `is_quarantined = true`.
   - If `decision = 'approve'` or `decision = 'delete'` → set `is_quarantined = false`.
   - If `decision = 'flag'` and `quarantine = false` → leave `is_quarantined` unchanged (a non-quarantining flag doesn't change visibility).
   The actual SmugMug folder move is the **application's** responsibility, triggered by observing this column change. The trigger updates DB state only.

4. **Bump `profiles.last_active_at` on `reviews` insert** (set to `now()` for the row whose `id = NEW.reviewer_id`).

5. **Snapshot `points_awarded` on `reviews` insert** (only if the inserter didn't supply it). Look up `points_config` and copy the appropriate value based on `NEW.decision`. This is a safety net; the app should also pass it explicitly so writes are obvious in code.

---

## Row-Level Security (outline)

Enable RLS on every table. Default deny.

**`profiles`**
- `select`: any authenticated user can read all rows (needed for displaying reviewer names on reviews, leaderboard, etc.)
- `update`: a user can update their own row's display fields; `role` and `team` are admin-only
- `insert`/`delete`: admin only (or service role via the auto-create trigger)

**`photos`, `divisions`, `locations`, `camp_weeks`**
- `select`: any authenticated user
- `insert`/`update`/`delete`: service role only (these are written by the SmugMug import job, not by the app)

**`tags`, `examples`, `senior_routing_rules`, `points_config`, `app_settings`**
- `select`: any authenticated user
- `insert`/`update`/`delete`: admin role only

**`reviews`**
- `select`: any authenticated user (the leaderboard, profile, and admin overview all need broad read)
- `insert`:
  - Any authenticated user can insert with `decision in ('approve', 'flag')`
  - Only `senior` or `admin` can insert with `decision = 'delete'`
  - `reviewer_id` must match `auth.uid()` (prevents impersonation)
- `update`/`delete`: nobody (the log is immutable; mistakes get a new corrective review row)

**`review_tags`**
- Inherits effectively from `reviews` — same insert rules; nobody updates/deletes.

---

## Deferred — explicitly not in this schema (yet)

These come up in the existing UI but aren't blocking the core flow. Add when the Leaderboard/Profile screens move off mock data:

- **`badges` and `user_badges`** — for the Profile screen's achievement list
- **`streaks`** — for the "Day 9 streak" counter
- **`activity_log`** — denormalized feed for the Profile's "Recent activity"; can also be derived from `reviews` + a few computed events

Document a placeholder migration for each so the order is established, but leave them empty.

---

## Implementation order (as built)

Each step landed as its own migration file under `supabase/migrations/` so each is independently testable and the migration log mirrors the design narrative.

| File | Purpose |
|---|---|
| `20260505000001_enums.sql` | Six enums |
| `20260505000002_profiles.sql` | `profiles` + `handle_new_user` trigger on `auth.users` |
| `20260505000003_folder_hierarchy.sql` | `divisions` → `locations` → `camp_weeks` + `camp_weeks_with_status` view |
| `20260505000004_tags.sql` | `tags` + seed from `data.tsx` |
| `20260505000005_photos.sql` | `photos` (no triggers yet) |
| `20260505000006_reviews_and_triggers.sql` | `reviews`, `review_tags`, all four review triggers |
| `20260505000007_config_tables.sql` | `points_config`, `app_settings`, `examples` + seeds |
| `20260505000008_senior_routing_rules.sql` | `senior_routing_rules` |
| `20260505000009_rls_policies.sql` | RLS + `is_admin()` / `is_senior_or_admin()` helpers |
| `20260505000010_badges_placeholder.sql` | Empty placeholder; reserves migration ordering |
| `20260505000011_streaks_placeholder.sql` | Empty placeholder |
| `20260505000012_activity_log_placeholder.sql` | Empty placeholder |

The real schema-level smoke test lives at `supabase/tests/smoke_test.sql` (deliberately outside `migrations/` so it isn't applied by `db push`). It's a transaction wrapped in `begin; ... rollback;` that seeds a minimal hierarchy, exercises all four review triggers, and verifies both check constraints. Run it after applying migrations with:

```bash
npx supabase db query --file supabase/tests/smoke_test.sql --linked
```

The last row should be `smoke test passed`. Anything else means an assertion raised — read the error message to find which.

After each migration: `npm run build`, push to GitHub. The build doesn't exercise the schema yet (the app still runs on mock data), but confirms nothing in the codebase regressed. The real exercise of the schema comes in step 7 of the roadmap (replacing localStorage with Supabase persistence).

---

## Open questions for the user (none blocking — just to surface)

- Is `team` going to be a free-text field on `profiles`, or should it be its own `teams` table? Free text is fine for now; can normalize later. *Implemented as free text per the original recommendation.*
- Are notification channels going to be all four (`email`/`slack`/`sms`/`inapp`) on day one, or should we cut sms/slack until those integrations actually exist? Schema supports all four; the app can ignore unsupported ones. *Implemented as `text[]` with a non-empty constraint; the app filters to whichever channels are wired up.*
- Should `delete` reviews preserve any record of the photo's `image_url` for post-deletion auditing, or is "the row exists with `decision = 'delete'`" enough? Current spec is the latter. *Implemented as the latter.*

---

## Apply / verify (operational)

The repo is linked to the Supabase project via `npx supabase link`; `supabase/.temp/` (gitignored) holds the link metadata. There's no `supabase/config.toml` and no `supabase init` was run — the goal was to keep the repo lean.

```bash
npx supabase db push --dry-run                                       # preview migrations
npx supabase db push                                                 # apply
npx supabase db query --file supabase/tests/smoke_test.sql --linked  # verify
```

Two operational gotchas worth knowing if the smoke test ever needs editing:

1. `set local session_replication_role = replica;` skips FK enforcement **and every user-defined trigger** in the same transaction. The four review triggers are exactly what the smoke test is meant to verify, so don't reach for that setting. Drop the FK temporarily inside the transaction instead — DDL is transactional in Postgres, so the script's trailing `rollback;` restores the constraint automatically.
2. Inside a single transaction, `now()` (the default for `reviews.created_at`) returns the transaction's start time, identical for every row. `order by created_at desc limit 1` is therefore non-deterministic across rows inserted in the same transaction. The smoke test filters by `decision` instead. New assertions should follow the same pattern.
