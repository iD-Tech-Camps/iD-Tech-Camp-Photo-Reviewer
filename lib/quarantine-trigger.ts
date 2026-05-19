/**
 * Client-side helper that pings the quarantine reconcile endpoint after
 * a triage action has flipped `photos.is_quarantined`.
 *
 * Fire-and-forget: the DB write is already saved and the UI has already
 * advanced by the time we run; the SmugMug-side `Image.Hidden` toggle is
 * a deferred side effect. Failures surface as a console warning — the
 * route handler additionally records a `quarantine_move` row in
 * `sync_log` so admins can spot drift on Photo sync → Sync log without
 * seeing a noisy red toast in the user flow.
 *
 * Call sites invoke with `void triggerQuarantineMove(id)` so the caller
 * doesn't await; awaiting would hold the UI on a SmugMug round-trip.
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
