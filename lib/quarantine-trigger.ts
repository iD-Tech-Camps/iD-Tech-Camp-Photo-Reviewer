/**
 * Step 8.7 — client-side helper that pings the quarantine reconcile
 * endpoint after a triage action has flipped `photos.is_quarantined`.
 *
 * The call is fire-and-forget. The DB write is already saved and the
 * UI has already advanced by the time we run; the SmugMug-side
 * `Image.Hidden` toggle is a deferred side effect. We surface failures
 * only as a console warning here — the route handler additionally
 * records a `quarantine_move` row in `sync_log` so admins can spot
 * drift on Admin → SmugMug → Sync log without seeing a noisy red toast
 * in the user flow.
 *
 * Post migration 26 the legacy call sites
 * (`ReviewScreen.commitDecision`, `FlagReview.resolve`) are gone with
 * their screens. The Step 3 triage flow wires this in from:
 *  - reviewer quarantine action inside a triage claim
 *  - senior release-quarantine action on the per-camp-week dashboard
 *
 * Both call sites should invoke this with `void triggerQuarantineMove(id)`
 * so the caller doesn't await; awaiting would hold the UI on a SmugMug
 * round-trip for no good reason.
 */
export async function triggerQuarantineMove(photoId: string): Promise<void> {
  try {
    const res = await fetch("/api/smugmug/quarantine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
    });
    if (!res.ok) {
      console.warn(
        `[quarantine-trigger] non-OK response (${res.status}) for photo ${photoId}`,
      );
      return;
    }
    const payload = (await res.json()) as { drift?: boolean; message?: string };
    if (payload?.drift) {
      console.warn(
        `[quarantine-trigger] drift for photo ${photoId}: ${payload.message ?? "unknown"}`,
      );
    }
  } catch (err) {
    console.warn(`[quarantine-trigger] fetch failed for photo ${photoId}:`, err);
  }
}
