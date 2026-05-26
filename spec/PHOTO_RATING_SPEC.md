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

## Migration

`20260520000034_photo_rating.sql`
