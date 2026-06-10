import "server-only";
import { randomBytes } from "node:crypto";
import { smugmugFetch, SmugMugApiError } from "./fetch";
import { getAuthUser } from "./index";
import { getUserRootNode } from "./users";
import { listNodeChildren } from "./nodes";
import { getAlbum } from "./albums";
import type { SmugMugNode } from "./types";

// Creates and populates Unlisted, link-shareable SmugMug galleries from a set
// of already-synced images, for the Photo Library "Gather into a SmugMug
// gallery" bulk action. This is the only place the app *creates* SmugMug
// content — everything else is read-only sync + the quarantine Hidden flag.
//
// All created albums live under a single dedicated folder so they don't clutter
// the account homepage. Images are *collected* (referenced) into the new album,
// not re-uploaded — the same image can live in many albums.

const FOLDER_NAME = "Photo Reviewer Collections";
const FOLDER_URLNAME = "Photo-Reviewer-Collections";

// SmugMug's !collectimages accepts many image URIs per call; chunk to keep each
// request body bounded.
const COLLECT_BATCH = 100;

/**
 * SmugMug UrlName rules: must start with an uppercase letter, contain only
 * letters/digits/hyphens, and be unique among its siblings. Sanitize an
 * arbitrary display name into a conforming slug (without the uniquifier).
 */
function toUrlName(raw: string): string {
  let s = raw
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) s = "Gallery";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/^[A-Za-z]/.test(s)) s = `G${s}`;
  return s.slice(0, 60);
}

function albumKeyFromUri(uri: string): string | null {
  const key = uri.split("/").filter(Boolean).pop();
  return key ?? null;
}

/**
 * Find (or create) the dedicated parent folder under the account root node.
 * Matches on UrlName (stable + URL-safe) rather than the editable display Name.
 */
async function ensureCollectionsFolder(): Promise<SmugMugNode> {
  const { NickName } = await getAuthUser();
  const root = await getUserRootNode(NickName);

  for await (const child of listNodeChildren(root.NodeID)) {
    if (child.Type === "Folder" && child.UrlName === FOLDER_URLNAME) {
      return child;
    }
  }

  const res = await smugmugFetch<{ Node: SmugMugNode }>(
    `/api/v2/node/${root.NodeID}!children`,
    {
      method: "POST",
      formBody: {
        Type: "Folder",
        Name: FOLDER_NAME,
        UrlName: FOLDER_URLNAME,
        Privacy: "Unlisted",
      },
    },
  );
  return res.Node;
}

/**
 * Create an Unlisted album (a node of Type=Album) under the given parent node.
 * Returns the album key + the shareable WebUri. Retries once with a fresh
 * suffix if SmugMug rejects the UrlName as a duplicate.
 */
async function createUnlistedAlbum(
  parentNodeId: string,
  displayName: string,
): Promise<{ albumKey: string; webUri: string }> {
  const base = toUrlName(displayName);

  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = randomBytes(4).toString("hex").slice(0, 6);
    const urlName = `${base}-${suffix}`;
    try {
      const res = await smugmugFetch<{ Node: SmugMugNode }>(
        `/api/v2/node/${parentNodeId}!children`,
        {
          method: "POST",
          formBody: {
            Type: "Album",
            Name: displayName,
            UrlName: urlName,
            Privacy: "Unlisted",
          },
        },
      );
      const node = res.Node;
      const albumUri = node.Uris?.Album?.Uri;
      const albumKey = albumUri ? albumKeyFromUri(albumUri) : null;
      if (!albumKey) {
        throw new SmugMugApiError(
          500,
          `/api/v2/node/${parentNodeId}!children`,
          "Album node created but response is missing Uris.Album — cannot collect images.",
        );
      }
      // Prefer the node's WebUri (the shareable gallery link); fall back to the
      // album resource if the create response omitted it.
      const webUri = node.WebUri ?? (await getAlbum(albumKey)).WebUri;
      if (!webUri) {
        throw new SmugMugApiError(
          500,
          albumUri ?? `/api/v2/album/${albumKey}`,
          "Album created but no WebUri available to share.",
        );
      }
      return { albumKey, webUri };
    } catch (err) {
      // Retry once on a likely UrlName collision; re-throw anything else.
      const collision =
        err instanceof SmugMugApiError &&
        (err.status === 409 || /urlname/i.test(err.bodyExcerpt));
      if (attempt === 0 && collision) continue;
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new SmugMugApiError(500, `/api/v2/node/${parentNodeId}!children`, "Failed to create album.");
}

/**
 * Collect existing images (by image key) into an album without re-uploading.
 * POSTs comma-joined image URIs to the album's !collectimages endpoint in
 * batches.
 */
async function collectImagesIntoAlbum(albumKey: string, imageKeys: string[]): Promise<void> {
  for (let i = 0; i < imageKeys.length; i += COLLECT_BATCH) {
    const chunk = imageKeys.slice(i, i + COLLECT_BATCH);
    const collectUris = chunk.map((k) => `/api/v2/image/${k}`).join(",");
    await smugmugFetch(`/api/v2/album/${albumKey}!collectimages`, {
      method: "POST",
      formBody: { CollectUris: collectUris },
    });
  }
}

/**
 * Create an Unlisted gallery from the given SmugMug image keys and return its
 * shareable URL. Auto-names the gallery from the current date/time.
 */
export async function createSharedGallery(
  imageKeys: string[],
  opts: { name?: string } = {},
): Promise<{ url: string; albumKey: string }> {
  const name = opts.name ?? defaultGalleryName();
  const folder = await ensureCollectionsFolder();
  const { albumKey, webUri } = await createUnlistedAlbum(folder.NodeID, name);
  await collectImagesIntoAlbum(albumKey, imageKeys);
  return { url: webUri, albumKey };
}

function defaultGalleryName(): string {
  // e.g. "Selected Photos 2026-06-10 14-32"
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Selected Photos ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
