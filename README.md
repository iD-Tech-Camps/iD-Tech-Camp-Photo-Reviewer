# iD Tech Camp Photo Reviewer Web App

Next.js 14 (App Router) + TypeScript + Tailwind CSS app for reviewing camp photos.

## Getting started

Prerequisites: Node.js 18.17 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command         | What it does                              |
| --------------- | ----------------------------------------- |
| `npm run dev`   | Start the dev server with hot reload      |
| `npm run build` | Production build                          |
| `npm run start` | Run the production build locally          |
| `npm run lint`  | Run ESLint (`next/core-web-vitals`)       |

## Environment variables

Copy `.env.local.example` to `.env.local` and fill in values when integrations are added.

```bash
cp .env.local.example .env.local
```

Currently all variables are placeholders — Supabase auth is wired in, SmugMug integration will be added in a later step.

## Reviewing photos

Reviewers see one photo at a time and have two actions:

- **Approve** (`A`) — share-worthy. Pick a star rating (1–5) and optional positive tags.
- **Flag** (`F`) — anything that isn't a clear approve. Tag every issue you see (quality, safety, consent, etc.) and add an optional reason note. A senior reviewer makes the final call.

There is no separate reject action — if a photo isn't acceptable, flag it.

## Roles

The app has three roles. Switch between them at any time using the **View as** picker in the sidebar footer (persisted to localStorage for the demo).

| Role            | Sees                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| Staff Reviewer  | Review queue, stats, profile, guide.                                                  |
| Senior Reviewer | Everything above, plus the **Flag review** queue with full per-photo metadata.        |
| Admin           | Everything above, plus the Admin section (overview, assignment, points, users, etc.). |

### Flag review (Senior Reviewer + Admin)

Lives in the sidebar under **Senior → Flag review**. For each flagged photo a reviewer sees:

- Camp, location, camp week + dates, activity, capture time
- Who flagged it (name + email) and when
- Negative tags chosen by the reviewer
- The reviewer's optional note

Three actions per photo:

- **Accept** — admit the photo back into the library and clear the flag.
- **Delete** — remove it (two-step confirm).
- **Download** — generates a PNG of the photo so it can be shared with a camp director as an example of what to improve.

## Project structure

```
app/                  Next.js App Router entry (layout, page, globals.css)
components/           Shared UI components (Icon, Shell, data, App)
components/screens/   Top-level screens (Home, Review, FlagReview, Leaderboard, Admin, etc.)
lib/                  Supabase clients + current-user/role context
styles/legacy.css     Full design-system stylesheet (imported by layout)
public/               Static assets
```
