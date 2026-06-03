import "server-only";
import { smugmugFetch } from "./fetch";
import type { SmugMugImage } from "./types";
import { SMUGMUG_SIZES, type SmugMugSize } from "./url-variants";

export async function getImage(imageKey: string): Promise<SmugMugImage> {
  const res = await smugmugFetch<{ Image: SmugMugImage }>(`/api/v2/image/${imageKey}`);
  return res.Image;
}

// One entry from SmugMug's !sizedetails payload (ImageSizeLarge, etc.).
interface SizeDetail {
  Url?: string;
  Width?: number;
  Height?: number;
  Ext?: string;
}

// SmugMug exposes per-size download URLs under !sizedetails. Each of our size
// tokens maps to a fixed field name in the ImageSizeDetails object.
const SIZE_FIELD: Record<SmugMugSize, string> = {
  Ti: "ImageSizeTiny",
  Th: "ImageSizeThumb",
  S: "ImageSizeSmall",
  M: "ImageSizeMedium",
  L: "ImageSizeLarge",
  XL: "ImageSizeXLarge",
  X2: "ImageSizeX2Large",
  X3: "ImageSizeX3Large",
  X4: "ImageSizeX4Large",
  X5: "ImageSizeX5Large",
  O: "ImageSizeOriginal",
};

export interface ImageSizeOption {
  size: SmugMugSize;
  url: string;
  width: number | null;
  height: number | null;
  ext: string | null;
}

/**
 * Resolve the usable download sizes for an image via the SmugMug v2 API
 * (`/api/v2/image/{key}!sizedetails`). Only sizes that actually have a Url are
 * returned (a 1000px-wide original won't have X4/X5), ordered smallest →
 * largest per SMUGMUG_SIZES.
 */
export async function getImageSizeDetails(imageKey: string): Promise<ImageSizeOption[]> {
  const res = await smugmugFetch<{ ImageSizeDetails: Record<string, SizeDetail | unknown> }>(
    `/api/v2/image/${imageKey}!sizedetails`,
  );
  const details = res.ImageSizeDetails ?? {};
  const out: ImageSizeOption[] = [];
  for (const size of SMUGMUG_SIZES) {
    const detail = details[SIZE_FIELD[size]] as SizeDetail | undefined;
    if (detail && typeof detail.Url === "string" && detail.Url) {
      out.push({
        size,
        url: detail.Url,
        width: typeof detail.Width === "number" ? detail.Width : null,
        height: typeof detail.Height === "number" ? detail.Height : null,
        ext: typeof detail.Ext === "string" ? detail.Ext : null,
      });
    }
  }
  return out;
}
