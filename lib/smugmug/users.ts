import "server-only";
import { smugmugFetch } from "./fetch";
import { SmugMugApiError } from "./fetch";
import type { SmugMugNode } from "./types";

/**
 * Returns the root Node for a given SmugMug user. The root node is the
 * implicit top-level folder under which all of that user's content lives;
 * its children are the top-level folders visible on the user's homepage.
 *
 * For the iD Tech account, the root's children are the four divisions
 * (iD Tech Camps, iD Teen Academies, Online Private Lessons, Virtual Tech
 * Camps) plus any retired ones still hanging around.
 *
 * SmugMug doesn't expose a `!node` shortcut on /api/v2/user/<nick>, so we
 * fetch the User object first and follow the `Uris.Node.Uri` relation.
 * Two cheap calls on cold start.
 */
export async function getUserRootNode(nickname: string): Promise<SmugMugNode> {
  const userRes = await smugmugFetch<{
    User: { Uris?: Record<string, { Uri: string }> };
  }>(`/api/v2/user/${encodeURIComponent(nickname)}`);

  const nodeUri = userRes.User?.Uris?.Node?.Uri;
  if (!nodeUri) {
    throw new SmugMugApiError(
      500,
      `/api/v2/user/${nickname}`,
      "User response is missing Uris.Node — cannot locate root node."
    );
  }

  const nodeRes = await smugmugFetch<{ Node: SmugMugNode }>(nodeUri);
  return nodeRes.Node;
}
