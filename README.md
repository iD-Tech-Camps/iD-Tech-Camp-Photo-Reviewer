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

Currently all variables are placeholders — Supabase and SmugMug integration will be wired up in a later step.

## Deployment

This project deploys to Vercel with zero configuration. Push to a Git repository and import it in the Vercel dashboard, or run `vercel` from the project root.

## Project structure

```
app/                  Next.js App Router entry (layout, page, globals.css)
components/           Shared UI components (Icon, Shell, data, App)
components/screens/   Top-level screens (Home, Review, Leaderboard, Admin, etc.)
styles/legacy.css     Full design-system stylesheet (imported by layout)
public/               Static assets
```
