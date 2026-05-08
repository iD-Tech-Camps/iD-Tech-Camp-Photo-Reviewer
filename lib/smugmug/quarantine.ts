import "server-only";
import { smugmugFetch, SmugMugApiError } from "./fetch";
import { listNodeChildren, getNode } from "./nodes";
import { getUserRootNode } from "./users";
import { getAuthUser } from "./index";
import type { SmugMugAlbum, SmugMugImage, SmugMugNode } from "./types";

/**
 * Step 8.7 — SmugMug API helpers for the quarantine folder move.
 *
 * Three thin wrappers that the reconcile core in `lib/smugmug/sync/quarantine.ts`
 * composes:
 *
 *   1. getImageAlbumKey(imageKey) — read the image's current parent album,
 *      used for idempotency (skip the move if the image is already in the
 *      target album; SmugMug's MoveImages=true is a no-op or 4xx in that
 *      case depending on the day, and we'd rather be deterministic).
 *
 *   2. moveImageToAlbum(imageUri, destAlbumKey) — single-image move via
 *      the documented `Album!collectimages` verb with MoveImages=true.
 *      One image at a time keeps the per-call URL-encoded body short and
 *      isolates per-photo failures (the quarantine flow is one-image-at-
 *      a-time anyway, so batching wouldn't help us).
 *
 *   3. findOrCreateUnlistedAlbumAtRoot(nickname, name, urlName) — used
 *      exclusively for the lazy-create-once Quarantined album. We list
 *      the root node's children first, then create on miss. The
 *      list-then-create pattern (vs. blind create-and-handle-collision)
 *      cleanly recovers from the "SmugMug create succeeded but our DB
 *      write failed" partial-failure case: the next call finds the
 *      existing album by name and persists its key without creating a
 *      duplicate.
 */

const PHOTO_REVIEWER_QUARANTINE_NAME = "Photo Reviewer — Quarantined";
// SmugMug requires UrlName to start with an uppercase letter, contain
// only letters/numbers/hyphens, and be 4–32 characters. This satisfies
// all three.
const PHOTO_REVIEWER_QUARANTINE_URL_NAME = "Photo-Reviewer-Quarantined";

export interface QuarantineAlbumIdentity {
  albumKey: string;
  nodeId: string;
  uri: string;
  webUri: string | null;
}

/**
 * Returns the album key the image currently lives in, or null if the
 * image isn't filed under an album (rare; happens for orphaned uploads
 * SmugMug occasionally surfaces). Used by the reconcile core to short-
 * circuit no-op moves before hitting `!collectimages`.
 */
export async function getImageAlbumKey(imageKey: string): Promise<string | null> {
  const res = await smugmugFetch<{ Image: SmugMugImage }>(
    `/api/v2/image/${imageKey}`
  );
  const albumUri = res.Image?.Uris?.Album?.Uri;
  if (!albumUri) return null;
  return parseAlbumKeyFromUri(albumUri);
}

/**
 * Moves a single image into `destAlbumKey`. SmugMug's documented verb
 * for "move (not copy)" is `Album!collectimages` with `MoveImages=true`.
 *
 * `CollectUris` accepts a comma-separated list of image URIs (the
 * `/api/v2/image/<key>` shape, not the bare key). The signed-fetch
 * wrapper percent-encodes the form body for us, so the comma stays
 * intact in the encoded string and SmugMug parses it as a single-item
 * list correctly.
 *
 * Throws SmugMugApiError on non-2xx so the caller can record drift.
 */
export async function moveImageToAlbum(
  imageUri: string,
  destAlbumKey: string
): Promise<void> {
  await smugmugFetch(`/api/v2/album/${destAlbumKey}!collectimages`, {
    method: "POST",
    formBody: {
      CollectUris: imageUri,
      MoveImages: "true",
    },
  });
}

/**
 * Find-or-create the photo-reviewer Quarantined album at the SmugMug
 * user root. Always Privacy=Unlisted, SmugSearchable/WorldSearchable=No.
 *
 * Lookup phase: list the root node's children and match against our
 * canonical name + url-name. SmugMug's UrlName is unique within a parent
 * folder, so this can never be ambiguous. We bail on the first hit —
 * if an admin manually renamed it we'll create a fresh one, which is
 * fine; the orphaned one becomes a one-time cleanup task on SmugMug.
 *
 * Create phase: POST under `folder/user/<nick>!albums`. SmugMug returns
 * the album payload with `Uris.Node` populated; we follow that to grab
 * the NodeID for symmetry with the rest of our codebase, even though
 * the move call only needs the AlbumKey.
 */
export async function findOrCreateQuarantineAlbum(): Promise<QuarantineAlbumIdentity> {
  const user = await getAuthUser();
  const nickname = user.NickName;
  if (!nickname) {
    throw new Error(
      "SmugMug !authuser response is missing NickName; cannot resolve user root."
    );
  }

  const root = await getUserRootNode(nickname);
  const existing = await findChildAlbumByUrlName(root.NodeID);
  if (existing) return existing;

  return await createQuarantineAlbumUnderRoot(nickname);
}

async function findChildAlbumByUrlName(
  rootNodeId: string
): Promise<QuarantineAlbumIdentity | null> {
  for await (const child of listNodeChildren(rootNodeId)) {
    if (child.Type !== "Album") continue;
    if (
      child.Name === PHOTO_REVIEWER_QUARANTINE_NAME ||
      child.UrlName === PHOTO_REVIEWER_QUARANTINE_URL_NAME
    ) {
      return await resolveAlbumIdentity(child);
    }
  }
  return null;
}

async function createQuarantineAlbumUnderRoot(
  nickname: string
): Promise<QuarantineAlbumIdentity> {
  // SmugMug accepts JSON or form-encoded; we already have form-encoded
  // wired through the OAuth signer (form params get folded into the
  // signature base string), so stick with that. Setting NiceName
  // makes the album feel less internal-tool-shaped to anyone who does
  // peek at SmugMug.
  const res = await smugmugFetch<{ Album: SmugMugAlbum }>(
    `/api/v2/folder/user/${encodeURIComponent(nickname)}!albums`,
    {
      method: "POST",
      formBody: {
        Name: PHOTO_REVIEWER_QUARANTINE_NAME,
        UrlName: PHOTO_REVIEWER_QUARANTINE_URL_NAME,
        Privacy: "Unlisted",
        SmugSearchable: "No",
        WorldSearchable: "No",
        Description:
          "Internal: photos quarantined by the iD Tech Photo Reviewer pending senior review.",
      },
    }
  );

  const album = res.Album;
  if (!album?.AlbumKey) {
    throw new SmugMugApiError(
      500,
      `/api/v2/folder/user/${nickname}!albums`,
      "Album create response is missing AlbumKey."
    );
  }
  return await resolveAlbumIdentity({
    NodeID: album.NodeID ?? "",
    AlbumKey: album.AlbumKey,
    Uri: album.Uri,
    WebUri: album.WebUri,
    Uris: album.Uris,
  });
}

// Pull NodeID off either an SmugMugNode (from list-children) or an
// SmugMugAlbum-shaped object (from the create response). The two share
// `Uris.Node.Uri` so a single resolver works.
async function resolveAlbumIdentity(
  source: {
    NodeID?: string;
    AlbumKey?: string;
    Uri?: string;
    WebUri?: string;
    Uris?: Record<string, { Uri: string }>;
  }
): Promise<QuarantineAlbumIdentity> {
  // The create response gives us AlbumKey directly; the list-children
  // walk gives us a Node whose Uris.Album.Uri carries it.
  let albumKey = source.AlbumKey;
  let albumUri = source.Uri;
  if (!albumKey || !albumUri) {
    const albumRel = source.Uris?.Album?.Uri;
    if (albumRel) {
      albumUri = albumRel;
      albumKey = parseAlbumKeyFromUri(albumRel) ?? undefined;
    }
  }
  if (!albumKey || !albumUri) {
    throw new Error("Cannot derive AlbumKey from SmugMug payload.");
  }

  let nodeId = source.NodeID;
  if (!nodeId) {
    const nodeUri = source.Uris?.Node?.Uri;
    if (nodeUri) nodeId = parseNodeIdFromUri(nodeUri) ?? undefined;
  }
  if (!nodeId) {
    // Last-ditch: the album resource itself carries Uris.Node when
    // expanded, so do one extra hop. Only triggered when the upstream
    // payload was unusually thin.
    nodeId = await fetchNodeIdForAlbum(albumKey);
  }

  return {
    albumKey,
    nodeId,
    uri: albumUri,
    webUri: source.WebUri ?? null,
  };
}

async function fetchNodeIdForAlbum(albumKey: string): Promise<string> {
  const res = await smugmugFetch<{ Album: SmugMugAlbum }>(
    `/api/v2/album/${albumKey}`
  );
  const nodeUri = res.Album?.Uris?.Node?.Uri;
  if (!nodeUri) {
    throw new Error(`Album ${albumKey} has no Node URI on payload.`);
  }
  const nodeId = parseNodeIdFromUri(nodeUri);
  if (!nodeId) throw new Error(`Cannot parse NodeID from "${nodeUri}".`);
  return nodeId;
}

function parseAlbumKeyFromUri(albumUri: string): string | null {
  // Shape: `/api/v2/album/<key>` (sometimes with a trailing query
  // string). Take the last path segment.
  const path = albumUri.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

function parseNodeIdFromUri(nodeUri: string): string | null {
  const path = nodeUri.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

// Re-export the node helper for callers that want to peek at the
// Quarantined album's identity without going through find-or-create
// (e.g. an admin diagnostic UI down the road).
export type { SmugMugNode };
export { getNode as getNodeForDiagnostic };
