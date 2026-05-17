import "server-only";
import { smugmugFetch, smugmugPaginate, type PaginateOptions } from "./fetch";
import type { SmugMugNode } from "./types";

export async function getNode(nodeId: string): Promise<SmugMugNode> {
  const res = await smugmugFetch<{ Node: SmugMugNode }>(`/api/v2/node/${nodeId}`);
  return res.Node;
}

export function listNodeChildren(
  nodeId: string,
  opts: PaginateOptions = {}
): AsyncGenerator<SmugMugNode, void, void> {
  return smugmugPaginate<SmugMugNode>(`/api/v2/node/${nodeId}!children`, "Node", opts);
}

/**
 * Given a node id, returns the album key for that node, or null when the
 * node has no `Uris.Album` resource. Used by the 8.4 photo-enumeration job to translate
 * a `camp_weeks.smugmug_folder_id` (a Node id) into the album-scoped
 * endpoint that lists images.
 *
 * SmugMug nests "this node has an album resource" under `Uris.Album.Uri`
 * with the shape `/api/v2/album/<key>`. When we already have the node
 * payload (e.g. from a `!children` walk) we should reuse that — this
 * helper is for the case where we only know the node id and don't want
 * to re-walk the parent.
 */
export async function getAlbumKeyForNode(nodeId: string): Promise<string | null> {
  const node = await getNode(nodeId);
  const albumUri = node.Uris?.Album?.Uri;
  if (!albumUri) return null;
  const key = albumUri.split("/").filter(Boolean).pop();
  return key ?? null;
}
