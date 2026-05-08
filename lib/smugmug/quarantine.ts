import "server-only";
import { smugmugFetch } from "./fetch";

/**
 * Step 8.7 — single SmugMug helper for the quarantine flow.
 *
 * The whole SmugMug-side mechanism for quarantine collapsed to one
 * call once we realized SmugMug already has a per-image visibility
 * flag (`Image.Hidden`). A hidden image stays in its album with all
 * its URLs and metadata intact, but is excluded from public album
 * views and search — exactly the behavior we want for "this is under
 * senior review, don't show it publicly yet."
 *
 * That's what we use here:
 *
 *   - quarantine                → setImageHidden(key, true)
 *   - release (senior accept)   → setImageHidden(key, false)
 *   - delete (senior delete)    → no-op; we don't change Hidden
 *
 * No album to find-or-create, no AlbumImage relationship to relocate,
 * no URL refresh, no idempotency probe (PATCHing Hidden to its
 * current value is a harmless no-op on SmugMug's side), no
 * many-to-many image/album reasoning. The reviewer's flag submission
 * and the senior's accept/delete still resolve in a single API
 * round-trip wrapped in our existing fire-and-forget handler.
 *
 * Wire format:
 *   PATCH /api/v2/image/<imageKey>
 *   Content-Type: application/json
 *   { "Hidden": true | false }
 *
 * `<imageKey>` is the bare ImageKey from `photos.smugmug_image_id`.
 * SmugMug 301-redirects bare keys to their versioned form
 * (`<key>-<version>`) on the standalone Image endpoint, and our
 * smugmugFetch wrapper transparently follows redirects with re-signing
 * (OAuth 1.0a binds the URL into the signature base string, so each
 * hop needs its own signature; that's already handled in fetch.ts).
 */
export async function setImageHidden(
  imageKey: string,
  hidden: boolean
): Promise<void> {
  await smugmugFetch<unknown>(`/api/v2/image/${imageKey}`, {
    method: "PATCH",
    jsonBody: { Hidden: hidden },
  });
}
