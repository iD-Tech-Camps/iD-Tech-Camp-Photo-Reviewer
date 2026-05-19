// SmugMug serves photos at a fixed set of size variants under a predictable
// URL pattern:
//
//   https://photos.smugmug.com/photos/i-{KEY}/{VERSION}/{HASH}/{SIZE}/i-{KEY}-{SIZE}.{ext}
//
// The size token appears twice — once as a path segment, once as a filename
// suffix — and both are always identical for a well-formed URL.
//
// `runPhotoSync` records two variants per photo: `image_url` (ArchivedUri /
// "O") and `thumbnail_url` ("Th"). The reviewer hero used to render the
// archive directly, which can be 10+ MB; this helper rewrites either stored
// URL to a chosen variant so we can hand the lightbox a ~200 KB XL instead.

export const SMUGMUG_SIZES = [
  "Ti", "Th", "S", "M", "L", "XL", "X2", "X3", "X4", "X5", "O",
] as const;

export type SmugMugSize = (typeof SMUGMUG_SIZES)[number];

// Anchored to the end of the URL (optional query string only) so we only
// match the final size segment. The \1 backref enforces that the size token
// in the path equals the size token in the filename — guards against false
// positives where the {HASH} segment happens to contain a literal like "Th".
const URL_PATTERN =
  /\/(Ti|Th|XL|X2|X3|X4|X5|S|M|L|O)\/(i-[A-Za-z0-9]+)-\1(\.[A-Za-z0-9]+)(\?.*)?$/;

export function smugmugVariantUrl(url: string, targetSize: SmugMugSize): string | null {
  const m = URL_PATTERN.exec(url);
  if (!m) return null;
  const [, currentSize, keyPrefix, ext, query] = m;
  if (currentSize === targetSize) return url;
  const prefix = url.slice(0, m.index);
  return `${prefix}/${targetSize}/${keyPrefix}-${targetSize}${ext}${query ?? ""}`;
}
