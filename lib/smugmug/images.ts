import "server-only";
import { smugmugFetch } from "./fetch";
import type { SmugMugImage } from "./types";

export async function getImage(imageKey: string): Promise<SmugMugImage> {
  const res = await smugmugFetch<{ Image: SmugMugImage }>(`/api/v2/image/${imageKey}`);
  return res.Image;
}
