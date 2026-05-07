import "server-only";
import { smugmugFetch } from "./fetch";
import type { AuthUserResponse } from "./types";

export { SmugMugApiError, smugmugFetch, smugmugPaginate } from "./fetch";
export type { FetchOptions, PaginateOptions } from "./fetch";
export type { OAuth1Credentials } from "./oauth";
export { loadCredentialsFromEnv, buildAuthorizationHeader } from "./oauth";
export * from "./types";

export { getNode, listNodeChildren } from "./nodes";
export { getAlbum, listAlbumImages } from "./albums";
export { getImage } from "./images";
export { getUserRootNode } from "./users";

/**
 * Returns the SmugMug user the current OAuth credentials are authorized
 * against. Used by the /api/smugmug/ping smoke endpoint to confirm signing
 * and credentials are wired correctly.
 */
export async function getAuthUser(): Promise<AuthUserResponse["User"]> {
  const res = await smugmugFetch<AuthUserResponse>("/api/v2/!authuser");
  return res.User;
}
