import "server-only";
import { smugmugFetch, smugmugPaginate, type PaginateOptions } from "./fetch";
import type { SmugMugAlbum, SmugMugImage } from "./types";

export async function getAlbum(albumKey: string): Promise<SmugMugAlbum> {
  const res = await smugmugFetch<{ Album: SmugMugAlbum }>(`/api/v2/album/${albumKey}`);
  return res.Album;
}

export function listAlbumImages(
  albumKey: string,
  opts: PaginateOptions = {}
): AsyncGenerator<SmugMugImage, void, void> {
  return smugmugPaginate<SmugMugImage>(
    `/api/v2/album/${albumKey}!images`,
    "AlbumImage",
    opts
  );
}
