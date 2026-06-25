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
app/api/photo-rating/override            # Photo Library: single rating correction
app/api/photo-rating/bulk-override       # Photo Library: bulk rating correction
app/api/photo-rating/quarantine          # Photo Library: single hide-from-parent toggle
app/api/photo-rating/bulk-quarantine     # Photo Library: bulk hide-from-parent toggle
```

## UI

- Sidebar: **Camp Photo Review** (`photo-rating` screen)
- Lead review: **Week assessment tags** card on `SeniorDashboard`
- Sidebar: **Photo Library** (`photo-gallery` screen) — see below

## Photo Library (marketing gallery)

Read-only browse of the rated pool, open to **every signed-in user**, for finding
and downloading the best photos for marketing. `components/screens/PhotoGallery.tsx`
+ data layer `lib/photo-gallery.ts`.

- **Pool:** `photos.rating_state = 'rated'`. Photos with `is_quarantined = true`
  ("hide from parent view") are excluded by default; the **Show hidden from parent view**
  filter toggle opts them back in (badged in the grid) so they can be restored.
- **Current rating:** denormalized onto `photos.current_rating` (migration 47), maintained
  by the existing `tg_photo_rating_events_after_insert_apply` trigger. A photo is rated by
  exactly one reviewer (the claim selector only picks `pending`), so the latest event wins.
- **Filters:** division → searchable location → week (week disabled until a location is picked,
  options grouped by year), min rating, `photo_rating` tags (tag filter = "has a rating event
  carrying the tag"), a **Show only my ratings** and **Show hidden from parent view** toggle, plus a
  **Clear filters** link. (Filter-dropdown options are derived from the non-hidden rated pool, so a
  week with *only* hidden photos won't appear in the week dropdown even with the toggle on; the grid
  itself still surfaces those photos when unfiltered.) **Sort:** rating / capture date. Server-side,
  paginated via `.range()` ("Load more"). Dropdown options are derived from the rated pool only
  (`camp_weeks` with a `photos!inner` filter), so empty divisions/locations never appear.
- **Lightbox:** rating + **rated by** (latest event's reviewer), location, week, capture date,
  `photo_rating` tags. Two downloads: **Download (full size)** streams the stored `image_url`
  (no SmugMug API call); **Other sizes…** lists sizes from SmugMug `!sizedetails` on demand. Both
  stream through `GET /api/smugmug/download`. Plus a **View on SmugMug** link (`photos.smugmug_url`).
  The SmugMug-generated `caption` and camp-quality-review status are intentionally not shown —
  irrelevant in a marketing context.
- **Rating correction (lightbox):** seniors/admins (and a photo's own rater) get a **Change** link
  that sets `current_rating` via `POST /api/photo-rating/override`. A behind-the-scenes edit of the
  denormalized rating only — no rating event is appended, so attribution ("rated by") and
  gamification points are untouched.
- **Hide from parent view (lightbox):** seniors/admins (and a photo's own rater) get a
  **Hide from parent view** / **Restore parent view** toggle that flips the shared
  `photos.is_quarantined` flag via `POST /api/photo-rating/quarantine`, then reconciles the
  SmugMug `Image.Hidden` flag. This is the **same flag** the Camp Photo Review checkbox
  (`quarantine_intent`) and the Camp Quality Review screen's Hide/Restore buttons
  (`senior_quarantine` / `senior_release_quarantine`) write, so the status is shared across all
  three screens. Unlike those flows it appends **no event** (mirroring rating override), which also
  avoids the triage trigger's `triage_maybe_enter_senior_review` side effect — a marketer toggling
  visibility must not pull a camp week into lead review. The write goes through the service client
  after an app-level auth check.

### Multi-select & bulk actions

A Google-Drive-style **Select** toggle in a toolbar below the filters. In select mode each grid tile
gets a checkbox + selection ring and clicking toggles selection instead of opening the lightbox;
selection is keyed by photo id, so it survives "Load more". The toolbar shows "N selected",
Select-all-loaded / Clear, and three actions:

- **Download .zip** — `POST /api/smugmug/download-zip` streams a zip of web-size images (XL → L →
  stored Original fallback, derived from `image_url` via `smugmugVariantUrl` — no SmugMug API call).
  Images are prefetched server-side with bounded concurrency and zipped store-only (`archiver`, since
  JPEGs are already compressed). **Capped at 60 photos** (client + server) to stay within the
  serverless time/memory limit — which is why web sizes, not Originals, are bundled. Unreachable
  images are skipped rather than failing the whole zip, and the count is reported via an
  `X-Zip-Skipped` response header.
- **Create SmugMug gallery** — `POST /api/smugmug/gallery` creates an **Unlisted**, link-shareable
  album under a "Photo Reviewer Collections" folder and *collects* the selected (already-synced)
  images into it (no re-upload). A modal lets the user edit the auto-suggested title before creating,
  then shows a clickable link (opens in a new tab) on success. Helpers live in
  `lib/smugmug/collections.ts` — **the app's only SmugMug write path beyond the quarantine Hidden
  flag** (album/folder create via `POST …!children`, image collection via `…!collectimages`).
- **Change rating** (seniors/admins only) — `POST /api/photo-rating/bulk-override` sets
  `current_rating` on all selected photos via the service client, with the same correction semantics
  as the single-photo lightbox path above (no events/attribution/points change). Returns the count
  actually updated.
- **Parent view** (seniors/admins only) — a **Hide from parent view** / **Restore parent view**
  popover; `POST /api/photo-rating/bulk-quarantine` flips `is_quarantined` on all selected photos
  via the service client (capped at 60), then reconciles each photo's SmugMug `Image.Hidden` flag
  with bounded concurrency. Same no-event semantics as the single-photo toggle. Returns the count
  actually updated.

### Local dev
`scripts/capture-gallery-fixture.mjs` does a one-time read-only pull from prod into a gitignored
`.dev-seed/gallery-fixture.json`. The dev-bar **Reseed dev data** button (and `POST /api/dev/seed`)
loads that fixture into the local DB — day-to-day reseeding never touches prod. A single dev login
(`dev@idtech.com`) with a dev-bar **role selector** (`POST /api/dev/role`) previews each role.
All dev routes/UI are gated behind `NEXT_PUBLIC_DEV_AUTH=1` and 404 in production.

## Migrations

- `20260520000034_photo_rating.sql`
- `20260603000047_photo_current_rating.sql` — `photos.current_rating` + index + trigger + backfill (Photo Library)
