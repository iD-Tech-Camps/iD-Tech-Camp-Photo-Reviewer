# Photo Rating Spec — Camp Photo Review

Parallel workflow to Camp Quality Review (triage). Reviewers rate photos 1–5 stars with optional tags and optional quarantine.

## State machines

### Camp week (`camp_weeks.rating_state`)

- `not_required` — week not in photo review (`rating_role = none`)
- `rating_role`: `first_week` and `second_week_recheck` mirror triage; `later_week` is week 3+ at the location (photo review only, no camp quality review)
- `awaiting_photos` / `photos_in` / `rating_in_progress` / `rating_done` / `complete`

### Photo (`photos.rating_state`)

- `not_required`, `pending`, `in_progress`, `rated`

## Claims

- Table: `photo_rating_claims` (mirror `triage_claims`)
- Max **3** active claims per reviewer
- Reuses `triage_config.batch_size` and `claim_expiry_minutes`
- Cron: `GET /api/photo-rating/sweep-claims` → `photo_rating_claims_expire_inactive()`

## Events

- Table: `photo_rating_events` — `rating` 1–5 required; `quarantine_intent` optional (no tags required)
- Tags: `photo_rating_event_tags` → `tags` where `'photo_rating' = any(purposes)`

## Tags

`tags.purposes` enum array:

| Purpose | Use |
|---------|-----|
| `quality_flag` | Camp Quality Review issue library |
| `photo_rating` | Optional on star ratings |
| `week_senior` | Lead review week assessment (junction `camp_week_senior_tags`) |

RPC: `photo_rating_set_week_tags(camp_week_id, tag_ids[])`

## API routes

```
app/api/photo-rating/claims
app/api/photo-rating/claims/[id]/release
app/api/photo-rating/events
app/api/photo-rating/week-tags
app/api/photo-rating/sweep-claims
```

## UI

- Sidebar: **Camp Photo Review** (`photo-rating` screen)
- Lead review: **Week assessment tags** card on `SeniorDashboard`
- Sidebar: **Photo Library** (`photo-gallery` screen) — see below

## Photo Library (marketing gallery)

Read-only browse of the rated pool, open to **every signed-in user**, for finding
and downloading the best photos for marketing. `components/screens/PhotoGallery.tsx`
+ data layer `lib/photo-gallery.ts`.

- **Pool:** `photos.rating_state = 'rated'` and `is_quarantined = false` (quarantined /
  "hide from parent view" photos are excluded).
- **Current rating:** denormalized onto `photos.current_rating` (migration 47), maintained
  by the existing `tg_photo_rating_events_after_insert_apply` trigger. A photo is rated by
  exactly one reviewer (the claim selector only picks `pending`), so the latest event wins.
- **Filters:** division → searchable location → week (week disabled until a location is picked,
  options grouped by year), min rating, `photo_rating` tags (tag filter = "has a rating event
  carrying the tag"), plus a **Clear filters** link. **Sort:** rating / capture date. Server-side,
  paginated via `.range()` ("Load more"). Dropdown options are derived from the rated pool only
  (`camp_weeks` with a `photos!inner` filter), so empty divisions/locations never appear.
- **Lightbox:** rating + **rated by** (latest event's reviewer), location, week, capture date,
  `photo_rating` tags. Two downloads: **Download (full size)** streams the stored `image_url`
  (no SmugMug API call); **Other sizes…** lists sizes from SmugMug `!sizedetails` on demand. Both
  stream through `GET /api/smugmug/download`. Plus a **View on SmugMug** link (`photos.smugmug_url`).
  The SmugMug-generated `caption` and camp-quality-review status are intentionally not shown —
  irrelevant in a marketing context.

### Local dev
`scripts/capture-gallery-fixture.mjs` does a one-time read-only pull from prod into a gitignored
`.dev-seed/gallery-fixture.json`. The dev-bar **Reseed dev data** button (and `POST /api/dev/seed`)
loads that fixture into the local DB — day-to-day reseeding never touches prod. A single dev login
(`dev@idtech.com`) with a dev-bar **role selector** (`POST /api/dev/role`) previews each role.
All dev routes/UI are gated behind `NEXT_PUBLIC_DEV_AUTH=1` and 404 in production.

## Migrations

- `20260520000034_photo_rating.sql`
- `20260603000047_photo_current_rating.sql` — `photos.current_rating` + index + trigger + backfill (Photo Library)
