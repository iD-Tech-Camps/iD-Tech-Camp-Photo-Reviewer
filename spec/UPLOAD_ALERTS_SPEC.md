# Upload Alerts — spec

> Weekly "a location stopped uploading" nudge for lead reviewers. Part of the Lead review hub — see [`LOCATION_APPROVAL_SPEC.md`](./LOCATION_APPROVAL_SPEC.md) for the surrounding surface. Migration `20260701000050_upload_alerts.sql`.

---

## 0. Framing

The app has no per-location camp schedule to say which weeks to expect photos for, and we deliberately did **not** add one (a per-location date-range settings area would need annual upkeep and would re-fire on legitimate off-weeks). Instead the alert uses a **relative** signal: a location that was uploading and then goes quiet, judged against its peers.

This is a lead-facing nudge, not an SLA. False positives are dismissible; the cost of a missed edge case is low.

## 1. The signal

The weekly job flags a non-ignored location when **all** hold:

1. Its **currently-active** camp week (`current_date between starts_on and ends_on`) exists and holds **zero** photos, **and**
2. Its **immediately-preceding** camp week **had** photos — establishes "this location was recently active." This also auto-suppresses a genuine last week of camp, which has no current week to flag, **and**
3. At least one **other** non-ignored location received photos for its own current week — a **circuit breaker**: if nothing came in anywhere, the sync pipeline is likely down or it's a holiday, so suppress every alert rather than storm the lead.

**Not covered by design:**

- **Cold start** ("never uploaded a first week") — already surfaced by the `photos_arriving` lifecycle bucket on the hub, so it isn't duplicated here.
- **Sole final-week location** — if only one location runs the last week and it stays silent, there's no peer to satisfy the circuit breaker, so no alert. Accepted tail-case.
- **Off-weeks** need no special handling: a scheduled gap has no `camp_weeks` row covering today, so the location simply isn't evaluated that week.

Alerts fire **regardless of approval status** — approval closes the *review* queue, but "did they upload" is a separate operational concern.

## 2. Behavior contract

- The check runs **weekly** (Vercel Cron, Wednesday 10:00 UTC — a margin after the 08:00 UTC daily sync so it always sees freshly-synced data) via `generate_upload_alerts()`, called under the **service role**.
- An alert is a **persisted record**. It **stays until a lead dismisses it** — it is **never** auto-cleared when photos eventually arrive. (Per stakeholder: the lead chases the RM and dismisses once photos land.)
- **One alert per `(location_id, week_start)`, ever.** `ON CONFLICT DO NOTHING` means re-running never duplicates, and a dismissed alert is never re-raised. The next week is a new `week_start`, so a still-silent location alerts afresh.
- Display fields (`location_name` / `division_name` / `week_label`) are **snapshotted** at detection time so dismissed-alert history stays accurate even if a location is renamed or a `camp_weeks` row is later removed.

## 3. Schema

`public.upload_alerts` — `id`, `location_id` (FK, cascade), `camp_week_id` (FK, set null), `week_start` (date), snapshot `location_name` / `division_name` / `week_label`, `detected_at`, `dismissed_at`, `dismissed_by` (FK profiles). `check ((dismissed_at is null) = (dismissed_by is null))`.

- Unique index `(location_id, week_start)` — the dedupe key.
- Feed index `(dismissed_at, detected_at desc)`.
- RLS: `select` for authenticated; no client write policy.

**RPCs:**

- `generate_upload_alerts() returns setof upload_alerts` — `SECURITY DEFINER`, granted to `service_role` only. Runs the circuit breaker, then inserts flagged rows and returns the newly-inserted set (empty when the breaker trips or nothing is flagged).
- `dismiss_upload_alert(p_alert_id uuid) returns upload_alerts` — `SECURITY DEFINER`, `is_senior_or_admin()` gate, granted to `authenticated`. Stamps `dismissed_at`/`dismissed_by`; raises `P0002` if already dismissed.

## 4. API routes

- `GET /api/alerts/weekly-upload-check` — the cron target. `CRON_SECRET` bearer auth (mirrors `sync-scheduled`); calls `generate_upload_alerts()` under the service role. Returns `{ ok, created }`.
- `POST /api/alerts/:id/dismiss` — `requireRole(["senior","admin"])`; calls `dismiss_upload_alert`. `P0002` → 409 `not_active`.

Manual trigger (verify without waiting for Wednesday):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/alerts/weekly-upload-check
```

## 5. UI

`AlertsSection` at the top of the Lead review hub (`components/screens/SeniorReview.tsx`, `LocationListView`). Active alerts render as rose-accented cards (division · location, missed week, detected-relative time) each with **Dismiss**; dismissed alerts move into a collapsible **Dismissed** history disclosure (who/when). The section is hidden entirely when there are no alerts. Client fetch/dismiss lives in `lib/upload-alerts.ts`.

## 6. Testing

`supabase/tests/e2e_upload_alerts.sql` — covers circuit breaker, happy-path flag, the three suppressions (peer / last-week / cold-start), dedupe, and dismiss + re-dismiss (`P0002`). Weeks are created relative to `current_date` so the suite is date-agnostic. Run via `psql` (see README → Tests).

## 7. Annual rollover

None. There is no per-location config to update each summer — the signal recomputes from live `camp_weeks` + `photos` every week.
