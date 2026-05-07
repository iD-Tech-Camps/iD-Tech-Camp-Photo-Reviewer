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
