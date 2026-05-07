# iD Tech Camp Photo Reviewer Web App

Internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Next.js 14 (App Router) + TypeScript + Supabase (Postgres + Google OAuth).

For working-session context (architecture, roadmap, decisions, known gotchas), see [`spec/PROJECT_CONTEXT.md`](./spec/PROJECT_CONTEXT.md). For the database design, see [`spec/SCHEMA_SPEC.md`](./spec/SCHEMA_SPEC.md).

## Getting started

Prerequisites: Node.js 18.17 or newer, an `.env.local` with the two Supabase variables below.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or whatever port Next picks if 3000 is busy). You'll be redirected to `/login` and have to sign in with an `@idtech.com` Google Workspace account.

## Scripts

| Command         | What it does                              |
| --------------- | ----------------------------------------- |
| `npm run dev`   | Start the dev server with hot reload      |
| `npm run build` | Production build (Vercel runs this — it's stricter than `dev`) |
| `npm run start` | Run the production build locally          |
| `npm run lint`  | Run ESLint (`next/core-web-vitals`)       |

## Environment variables

`.env.local` (gitignored) needs:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

Both are also set in Vercel (all environments). Domain-restriction is enforced at the Google Workspace OAuth layer, not in app code.

## Reviewing photos

Reviewers see one photo at a time and have two actions:

- **Approve** (`A`) — share-worthy. Pick a star rating (1–5) and optional positive tags.
- **Flag** (`F`) — anything that isn't a clear approve. Tag every issue you see (quality, safety, consent, etc.) and add an optional reason note. A senior reviewer makes the final call. The flag dialog also exposes a **Quarantine** checkbox; tick it for clear safety / dress-code / consent issues so the photo is hidden from the public folder until a senior resolves it (the trigger flips `photos.is_quarantined` on insert; the SmugMug folder move lands with step 8).

There is no separate reject action — if a photo isn't acceptable, flag it.

If an admin has scheduled a **Points Multiplier Bonus** (Admin → Points & rules → Points multiplier bonus), reviewers see a pennant on the home screen and in the review-screen header during the active window, and the points shown on the Approve / Flag buttons + the post-decision toast are multiplied accordingly. The bonused value is also what gets written into `reviews.points_awarded` — the client passes it explicitly on insert; the trigger's `points_config` lookup is the fallback for non-bonused write paths (senior accept/delete on Flag review).

Each decision writes a `reviews` row plus matching `review_tags` rows to Supabase. A trigger automatically:

- Updates `photos.current_status` (`pending` → `approved` / `flagged` / `deleted`)
- Maintains `photos.is_quarantined` for flag-with-quarantine
- Bumps `profiles.last_active_at` on the reviewer
- Snapshots `points_awarded` from `points_config` when the client didn't pass an explicit value (so future rate changes don't rewrite history)

The `reviews` log is **immutable** by design — corrections are recorded as a new review row, not by updating an old one. RLS enforces that the only inserts allowed are `reviewer_id = auth.uid()` (with `delete` decisions further restricted to seniors and admins).

## Roles

The app has three roles, matching the Postgres `role` enum exactly:

| DB enum    | UI label          | Sees |
| ---------- | ----------------- | ---- |
| `reviewer` | "Staff Reviewer"  | Review queue, stats, profile, guide. Default for any signed-in user (set by `handle_new_user` trigger on `auth.users` insert). |
| `senior`   | "Senior Reviewer" | Everything above, plus the **Flag review** queue. |
| `admin`    | "Admin"           | Everything above, plus the Admin section (overview, assignment, points, examples, users, app settings). |

Promote / demote reviewers from `Admin → Overview` — the per-row dots button opens an editor for `role` and `team`. The form refuses to demote the currently-signed-in admin out of the admin role (lockout protection); for stuck cases, edit `profiles.role` directly in Supabase.

### Example library (Admin)

`Admin → Example library` is upload-driven: every example is a real image admins upload directly. Files land in the `example-images` Supabase Storage bucket; metadata sits in `public.examples`. Drag a card to reorder within the active Good/Bad tab — the new order is persisted via the `public.reorder_examples` RPC in a single transaction, so a partial network failure can't half-apply the ordering. Reviewers see the same images in `Guide & examples` in the order admins curated. The 10 MB per-file cap is enforced client-side; storage RLS additionally blocks non-admin uploads at the DB layer.

### Flag review (Senior Reviewer + Admin)

Lives in the sidebar under **Senior → Flag review**. For each flagged photo a reviewer sees:

- Division, location, camp week + dates, caption, capture time
- Who flagged it (name + email) and when
- Negative tags chosen by the reviewer
- The reviewer's optional note
- A "Quarantined" badge if the flag set `quarantine = true`

Three actions per photo:

- **Accept** — writes an `approve` review under the senior's id; the trigger flips `current_status` back to `approved` and clears any quarantine.
- **Delete** — writes a `delete` review (requires `senior` or `admin`); the trigger sets `current_status = 'deleted'`.
- **Download** — generates a PNG of the placeholder render so it can be shared with a camp director offline (no DB write). Will switch to the real SmugMug image URL once step 7 lands.

## Database

The full schema is documented in [`spec/SCHEMA_SPEC.md`](./spec/SCHEMA_SPEC.md). Migrations live under `supabase/migrations/` and are applied with the Supabase CLI:

```bash
npx supabase db push --dry-run --linked   # preview
npx supabase db push --linked             # apply
```

Four test files under `supabase/tests/` (hand-run, not migrations):

```bash
npx supabase db query --file supabase/tests/smoke_test.sql           --linked  # schema-level
npx supabase db query --file supabase/tests/e2e_review_flow.sql      --linked  # reviewer flow under role=authenticated
npx supabase db query --file supabase/tests/e2e_flag_review_flow.sql --linked  # senior flow under role=authenticated
npx supabase db query --file supabase/tests/e2e_reviewer_stats.sql   --linked  # reviewer_stats view under role=authenticated
```

The last row of each is a sentinel string. `smoke test passed`, `e2e review flow passed`, `flag review flow passed`, or `reviewer stats view passed` means OK; anything else is an assertion failure inside the `do $$ ... $$` block.

> **If you write a new test that exercises app-style writes, pin the role to `authenticated` and set `request.jwt.claims`** — `supabase db query` runs as the service role by default, which bypasses RLS entirely. See `e2e_review_flow.sql` for the pattern.

## Project structure

```
app/                  Next.js App Router entry (layout, page, login, auth/callback)
components/           Shared UI (Icon, Shell, settings, App, data — gradient placeholder renderer)
components/screens/   Top-level screens (Home, Review, FlagReview, Leaderboard, Profile, Guide, Admin)
lib/
  current-user.tsx    UserProvider, useCurrentUser, Role type, ROLE_LABEL — reads role from profiles
  reviews.ts          fetchPendingPhotos, fetchPendingCount, fetchFlaggedPhotos, fetchFlaggedCount, submitReview
  profile.ts          fetchMyStats, fetchReviewerRoster, updateReviewerProfile — reads from `reviewer_stats` view (migration 15); admin role/team writes go to the `profiles` base table
  tags.ts             fetchTags + admin write helpers — backs ReviewScreen, FlagReview, and Admin TagLibrary
  app-settings.ts     fetchAppSettings + updateAppSettings — backs SettingsProvider
  points-config.ts    fetchPointsConfig + updatePointsConfig + basePointsFor — backs ReviewScreen + AdminPoints
  bonus-periods.ts    fetch / create / update / delete / setEnabled — backs BonusPeriodsProvider
  examples.ts         fetch / create / updateMetadata / replaceImage / delete / reorder — backs AdminExamples + GuideScreen, owns Supabase Storage round-trips for the example-images bucket
  supabase/           browser, server, and middleware Supabase clients
middleware.ts         Root middleware → lib/supabase/middleware.ts (session refresh + auth gating)
styles/legacy.css     Source of truth for visual styling (Tailwind installed but unused)
supabase/
  migrations/         18 SQL migrations, applied to the work-account project
  tests/              smoke + two e2e tests (run under role=authenticated)
spec/
  PROJECT_CONTEXT.md  Working-session handoff doc — read this first
  SCHEMA_SPEC.md      Database design + post-implementation notes
```

## Deployment

`main` auto-deploys to Vercel. The remote URL: `https://id-tech-camp-photo-reviewer.vercel.app`.

The local `origin` remote points at the work-org canonical URL: `https://github.com/iD-Tech-Camps/iD-Tech-Camp-Photo-Reviewer.git`. Vercel does not follow GitHub repo redirects, so if the repo is moved again the Vercel project must be manually reconnected.
