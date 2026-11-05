// SmugMug serves photos at a fixed set of size variants. The size token
// appears twice in every rendition URL — once as a path segment, once as a
// filename suffix — and both are always identical for a well-formed URL:
//
//   .../{SIZE}/{STEM}-{SIZE}.{ext}
//
// Two URL shapes are seen in practice:
//
//   1. Production (custom-domain/folder paths). The stem is the original
//      camera filename, and the API's `ArchivedUri` comes back at size "D":
//        https://photos.smugmug.com/IDTC/UW/2026/August10August142026/i-xxBqhHs/0/{HASH}/D/IMG_5244-D.jpg
//
//   2. Legacy / generic. The stem is the image key:
//        https://photos.smugmug.com/photos/i-{KEY}/{VERSION}/{HASH}/{SIZE}/i-{KEY}-{SIZE}.{ext}
//
// Swapping the token in both places yields another rendition of the same
// image (e.g. .../D/IMG_5244-D.jpg ≈1.6 MB → .../XL/IMG_5244-XL.jpg).
//
// `runPhotoSync` stores `image_url` = ArchivedUri (size "D" on prod — the
// uploaded original; byte-identical to the "O" rendition) and
// `thumbnail_url` = ThumbnailUrl ("Th"). Rendering the archive directly is
// multi-MB; this helper rewrites either stored URL to a chosen variant so the
// lightbox can load an XL instead.

// Target sizes we can request. These map 1:1 to SmugMug's !sizedetails
// fields (see lib/smugmug/images.ts) and drive the download size menu, so
// only add a size here if it has a corresponding ImageSizeDetails field.
export const SMUGMUG_SIZES = [
  "Ti", "Th", "S", "M", "L", "XL", "X2", "X3", "X4", "X5", "O",
] as const;

export type SmugMugSize = (typeof SMUGMUG_SIZES)[number];

// Anchored to the end of the URL (optional query string / fragment only) so
// we only match the final size segment. Recognized *source* sizes are every
// SMUGMUG_SIZES entry plus "D" (the download URL prod stores in image_url);
// "D" is deliberately not a target size — request "O" for the original.
//
// The stem is any run of non-separator characters, so camera filenames with
// "-", "_", "." or URL-encoded spaces ("%20") all match. The \1 backref
// enforces that the size token in the path equals the size token in the
// filename — guards against false positives where the {HASH} segment happens
// to contain a literal like "Th", and against mismatched path/filename pairs.
const URL_PATTERN =
  /\/(Ti|Th|XL|X2|X3|X4|X5|S|M|L|O|D)\/([^/?#]+)-\1(\.[A-Za-z0-9]+)([?#].*)?$/;

export function smugmugVariantUrl(url: string, targetSize: SmugMugSize): string | null {
  const m = URL_PATTERN.exec(url);
  if (!m) return null;
  const [, currentSize, stem, ext, suffix] = m;
  if (currentSize === targetSize) return url;
  const prefix = url.slice(0, m.index);
  return `${prefix}/${targetSize}/${stem}-${targetSize}${ext}${suffix ?? ""}`;
}
