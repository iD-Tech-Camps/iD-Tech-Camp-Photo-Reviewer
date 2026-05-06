# iD Tech Photo Reviewer — Project Context

> **Purpose of this document:** Hand off context to a fresh Claude thread (or any collaborator) so we can pick up work without re-explaining the whole project. Update this whenever the architecture, infrastructure, or roadmap changes.

---

## What this app is

A gamified internal tool for iD Tech employees to review, tag, and triage photos pulled from the company's SmugMug account. Built as an internal web app, not customer-facing. Used by a known group of employees who sign in with their iD Tech Google Workspace accounts.

Reviewers move through a queue of photos and either **approve** them (share-worthy — rate, optionally tag, +10 pts) or **flag** them (anything that isn't a clear approve — tag what's wrong, optional note, +15 pts). Flagged photos go to a separate **Flag Review** queue handled by Senior Reviewers, who make the final call: accept the photo back into the library, delete it, or download it for an offline conversation with a director.

---

## Current status (as of last working session)

**The app is live, deployed, authenticated, and feature-complete on the UI side.** What works:
- Production deployment on Vercel
- Google OAuth login restricted to `@idtech.com` accounts (via Internal Google Workspace)
- Supabase backend wired up (auth + full step-5 database schema applied to the work-account project)
- Sidebar shows the authenticated user's email/initials
- Sign-out works
- Three-role system in the UI (`reviewer` / `senior` / `admin`) with role-gated nav and screens
- Reviewer flow: Approve / Flag with tags, ratings, optional notes, points, confetti
- Senior flow: Flag Review screen — accept / delete / download flagged photos
- Admin screens: Overview, Assignment, Points & rules, Example library, Users, App settings
- Settings provider for brand mark / tagline / leaderboard visibility / etc.
- Database schema: 12 migrations under `supabase/migrations/` (enums, profiles + auto-create trigger, folder hierarchy, tags + seed, photos, reviews + 4 triggers, config tables + seeds, routing rules, RLS, 3 deferred placeholders). Full smoke test at `supabase/tests/smoke_test.sql` passes against the live remote.

**What does NOT work yet:**
- No real data — the app still uses the mock data from the original prototype (`components/data.tsx`)
- No SmugMug API integration
- Decisions, ratings, tags currently persist only to `localStorage`, not the database (the schema is ready for them; wiring lands in step 6)
- The `profiles` table exists, but role assignment is still driven by the dev switcher in `useCurrentUser`; production wiring (read role from `profiles` joined to `auth.users`) lands in step 6
- Outstanding `npm audit` issues (Next.js 14.2.35 has known high-severity advisories; upgrade pending)

---

## Tech stack

- **Framework:** Next.js 14 (App Router) + TypeScript + Tailwind (installed but mostly unused — legacy CSS is the source of truth for visual styling)
- **Hosting:** Vercel (auto-deploys on push to `main`)
- **Database + Auth:** Supabase (Postgres + Google OAuth via `@supabase/ssr`)
- **OAuth provider:** Google Cloud (Internal Workspace app)
- **Local dev:** Node 18+, `npm run dev` on `localhost:3000`
- **Editor:** Cursor (used for all coding, including git operations via Source Control panel — no command-line git)

### Key project structure

```
app/
  layout.tsx              # root layout, loads Google Fonts + legacy.css
  page.tsx                # renders <App />
  globals.css             # tailwind directives only
  login/page.tsx          # Google sign-in screen
  auth/callback/route.ts  # OAuth callback handler
components/
  App.tsx                 # root client component, role-gated screen routing
  Shell.tsx               # Sidebar (with role-aware nav sections), PageHeader, fireConfetti, useToast
  Icon.tsx                # inline SVG icon set (includes log-out, flag)
  data.tsx                # mock constants — exports NEGATIVE_TAGS (13) and PHOTO_TAGS (mixed; positives derived locally inside ReviewScreen.tsx via PHOTO_TAGS.filter(t => t.color !== "rose")). Also SESSION_PHOTOS, FLAGGED_PHOTOS, EXAMPLES, BADGES, etc., and PhotoPlaceholder.
  settings.tsx            # SettingsProvider / useSettings (brand, leaderboard toggle, etc.)
  BrowserWindow.tsx       # ported from prototype, currently orphaned
  screens/
    HomeScreen.tsx
    ReviewScreen.tsx      # approve/flag flow with modals, tags, ratings
    LeaderboardProfileGuide.tsx
    Admin.tsx             # AdminOverview, AdminAssignment, AdminPoints, AdminExamples, AdminUsers, AdminSettings
    FlagReview.tsx        # senior-only queue: accept / delete / download
lib/
  current-user.ts         # UserProvider, useCurrentUser, Role type, ROLE_LABEL
  supabase/
    client.ts             # browser client (createBrowserClient)
    server.ts             # server client (createServerClient with cookies)
    middleware.ts         # session refresh + auth-gating logic
middleware.ts             # root middleware, delegates to lib/supabase/middleware.ts
styles/legacy.css         # ~650 lines, source of truth for visual styling
supabase/
  migrations/             # 12 SQL migrations applied to the work-account project (see SCHEMA_SPEC.md for the table)
  tests/
    smoke_test.sql        # hand-run schema verifier; transaction-wrapped with `rollback;` so it leaves no trace
  .temp/                  # gitignored — Supabase CLI cache (project-ref, pooler URL, version metadata)
spec/
  PROJECT_CONTEXT.md      # this file
  SCHEMA_SPEC.md          # database design + post-implementation notes
```

### Roles and access

Three roles, defined in `lib/current-user.ts`:

| Role | Sees | Notes |
|---|---|---|
| `reviewer` | Review, Leaderboard, Profile, Guide | Default for any signed-in user |
| `senior` | Everything a reviewer sees, plus **Flag review** | Reviews photos that regular reviewers flagged |
| `admin` | Everything, plus the **Admin** section (Overview / Assignment / Points / Examples / Users / Settings) | Full control |

Access is enforced in `App.tsx` via `screenAllowedFor(screen, role)`. Sidebar sections are conditionally rendered in `Shell.tsx`. Role assignment is currently a dev-only client-side switcher; production assignment will need to live in the database.

---

## Infrastructure references

> All keys/passwords are NOT stored in this doc. They live in Vercel env vars, `.env.local` (gitignored), and a password manager.

| Resource | Location | Notes |
|---|---|---|
| **Production URL** | `https://id-tech-camp-photo-reviewer.vercel.app` | Public URL, but middleware redirects unauthenticated users to `/login` |
| **GitHub repo** | Owned by work GitHub account, name: `iD-Tech-Camp-Photo-Reviewer` | Was originally on personal account; transferred to work |
| **Vercel project** | Personal Vercel account, connected to new GitHub repo location | Auto-deploys on push to `main` |
| **Supabase project** | Work-account Supabase, project ID stored separately | Old personal-account Supabase project should be deleted/paused |
| **Google Cloud project** | Personal Google account, project name "iD Photo Reviewer" | Internal Workspace app — only `@idtech.com` accounts can complete OAuth. Acceptable to leave on personal account; transferable later if needed. |

**Environment variables in use:**
- `NEXT_PUBLIC_SUPABASE_URL` — public Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase publishable key (the new `sb_publishable_...` format, stored under the legacy variable name for SDK compatibility)

Both set in Vercel (all environments) and in `.env.local` for local dev.

**Supabase URL configuration (already set):**
- Site URL: `https://id-tech-camp-photo-reviewer.vercel.app`
- Redirect URLs: `https://id-tech-camp-photo-reviewer.vercel.app/**` and `http://localhost:3000/**`

---

## Roadmap

| # | Step | Status |
|---|---|---|
| 1 | Convert prototype to Next.js | ✅ Done |
| 2 | Push to GitHub | ✅ Done |
| 3 | Deploy to Vercel | ✅ Done |
| 4 | Supabase + Google OAuth | ✅ Done |
| 5 | Database schema design | ✅ Done |
| 6 | **Replace `localStorage` with Supabase persistence** | ⏭️ Up next |
| 7 | SmugMug API integration | Pending |
| 8 | Next.js security upgrade (resolves audit warnings) | Pending |
| 9 | Polish + team rollout | Pending |

> **Why 6 and 7 swapped.** Wiring the app to the database before ingesting real photos is the cheapest way to validate the freshly-applied schema — every table, trigger, and RLS policy gets exercised through the production code path while changes are still cheap. Step 6 is also self-contained (uses `SESSION_PHOTOS` seeded into `photos` for dev), whereas step 7 brings in an external API, an import job, and quarantine folder mechanics. Doing the dependency-free step first reduces concurrent unknowns. After step 6 the app reads roles from `profiles` and writes real `reviews`; after step 7 it sees real photos.

---

## Working style / preferences

For the human picking up this work in a fresh thread, here's what's been useful:

- **One step at a time.** Big plans are nice but get overwhelming. Concrete next click > comprehensive theory.
- **Explain the *why*, not just the *what*.** When suggesting an action, briefly say what it does and why it matters — this is the user's first time through this stack.
- **Cursor (Agent mode) does the coding.** Don't write large code blocks for the user to paste — give them prompts to give to Cursor instead. Always ask Cursor to show its plan before writing code, and to run `npm run build` locally before the user commits.
- **No command line.** All git operations happen via Cursor's Source Control panel. The user is on Windows, so be aware of PowerShell quirks if terminal commands ever come up.
- **Verify before locking in.** Push intermediate states to GitHub frequently so we have rollback points. `npm run build` (not just `npm run dev`) is the truth — Vercel runs the strict build, dev mode is lenient.
- **Be honest about uncertainty.** OAuth flows, deployment configs, and DNS-adjacent things often fail on the first try. Warn the user, don't oversell.

---

## Decisions already made (don't relitigate without reason)

- **Hosting on Vercel, not WordPress plugin.** WordPress was considered (would have lived inside an existing internal site, idemailwiz.com) but rejected — wrong tool for a React/gamified UI, plus access-control concerns.
- **Default Vercel `*.vercel.app` URL is fine for now.** Custom subdomain via company DNS deferred to avoid blocking on engineering team. Cheap standalone domain remains an option.
- **Domain restriction enforced at Google Workspace layer (Internal OAuth app), not in app code.** No need for explicit email checks in middleware.
- **`strict: false` TypeScript.** Loose typing during prototype port; can tighten later.
- **Tailwind installed but not actively used.** Legacy CSS (`styles/legacy.css`) is the source of truth for visual styling. Available for new components.
- **`use client` on basically everything.** This app is fully interactive; not optimizing for server components right now. Acceptable tradeoff for an internal tool.
- **Two-decision review flow: approve or flag (no reject).** Reject was removed in favor of a flag → senior-review handoff. A flag is not a final decision; a senior reviewer accepts, deletes, or escalates. This is the workflow the schema needs to model.
- **Three roles, not two.** `reviewer` / `senior` / `admin`. Senior exists specifically to handle flagged photos — keeps regular reviewers from being final arbiters on edge cases.
- **`camp_weeks.is_active` is a view, not a stored generated column.** Postgres requires stored generated columns to use `IMMUTABLE` expressions; `current_date` is `STABLE`, so the original spec definition was rejected on push. The boolean is exposed through `public.camp_weeks_with_status`. App code reads the view when it wants the flag; writes still go to the base table. Don't try to add it back as a column without picking up the immutability constraint.
- **Schema migrations live under `supabase/migrations/`; no `supabase init` was run.** No `config.toml`, no `seed.sql`, no functions templates. The repo is linked via `npx supabase link`; CLI cache lives in `supabase/.temp/` (gitignored). Use `npx supabase db push` to apply, `npx supabase db query --file supabase/tests/smoke_test.sql --linked` to verify.

---

## Known issues / gotchas to remember

- **`npm audit` reports 4 high-severity issues in Next.js 14.x.** The fix is a major-version upgrade (14 → 16). Deferred until after core features are working. **Don't run `npm audit fix --force`** — it will break the project mid-development.
- **Pre-existing build warning:** `no-page-custom-font` in `app/layout.tsx`. Cosmetic only. Google Fonts are loaded via `<link>` rather than `next/font` to preserve the existing CSS font stacks unchanged.
- **`localStorage` SSR pattern is in place** (`app/components/App.tsx`) — initial state is hardcoded, hydrated from `localStorage` in `useEffect`. Don't regress this.
- **OAuth flows usually fail on the first try.** When something breaks during auth setup, common causes are: (1) Supabase Site URL / Redirect URLs misconfigured, (2) Google Cloud authorized redirect URI missing or stale, (3) env vars not redeployed in Vercel after change (Vercel does NOT auto-redeploy on env var change), (4) browser holding stale session — test in incognito.
- **Vercel does not follow GitHub redirects.** If the repo is moved/transferred again in the future, the Vercel project must be manually reconnected to the new repo location.
- **Role switcher in `useCurrentUser` is a dev affordance, not production behavior.** The `profiles.role` column now exists in the database, but `useCurrentUser` still drives the UI from client state. Wiring the read happens in step 6. Don't ship to production with the dev switcher live.
- **`data.tsx` tag exports do not match what the spec wording suggests.** There is no `POSITIVE_TAGS` export — only `NEGATIVE_TAGS` (13 entries) and `PHOTO_TAGS` (mixed). Positives are derived locally inside `ReviewScreen.tsx` via `PHOTO_TAGS.filter(t => t.color !== "rose")`. The 7 rose-colored entries in `PHOTO_TAGS` are deprecated duplicates of `NEGATIVE_TAGS` with shorter labels — ignore them. The `tags` migration seeds the 13 negatives plus the 4 positives only.
- **Smoke test gotchas (for anyone editing `supabase/tests/smoke_test.sql`).**
  - `set local session_replication_role = replica;` skips FK enforcement *and every user-defined trigger* in the same transaction. The four review triggers are exactly what the test is meant to verify, so don't reach for that setting. Drop the FK temporarily inside the transaction instead — DDL is transactional in Postgres, so the trailing `rollback;` restores it automatically.
  - Inside one transaction, `now()` returns the transaction's start time, identical for every row inserted in that script. `order by created_at desc limit 1` is therefore non-deterministic when more than one review exists. Filter by `decision` (or another distinguishing column) instead. New assertions should follow the same pattern.

---

## How to resume in a fresh thread

Open a new conversation and paste this whole document, or attach it as a file. Then say something like:

> Picking up where I left off on the iD Photo Reviewer. Context attached. Ready to start step 6 (replace localStorage with Supabase persistence).

That's enough to get a fresh Claude oriented and moving in the same direction without re-explaining the journey.
