import { describe, expect, it } from "vitest";
import { smugmugVariantUrl } from "@/lib/smugmug/url-variants";

const BASE = "https://photos.smugmug.com/photos/i-abc123/0/AbCdEfGhIj";

describe("smugmugVariantUrl", () => {
  it("rewrites a thumbnail (Th) URL to XL", () => {
    const input = `${BASE}/Th/i-abc123-Th.jpg`;
    expect(smugmugVariantUrl(input, "XL")).toBe(`${BASE}/XL/i-abc123-XL.jpg`);
  });

  it("rewrites an archive (O) URL to XL", () => {
    const input = `${BASE}/O/i-abc123-O.jpg`;
    expect(smugmugVariantUrl(input, "XL")).toBe(`${BASE}/XL/i-abc123-XL.jpg`);
  });

  it("is idempotent when the URL is already at the target size", () => {
    const input = `${BASE}/XL/i-abc123-XL.jpg`;
    expect(smugmugVariantUrl(input, "XL")).toBe(input);
  });

  it("returns null for a URL with no recognizable size token", () => {
    expect(smugmugVariantUrl("https://example.com/some/random/path.jpg", "XL")).toBeNull();
    expect(smugmugVariantUrl("not-a-url", "XL")).toBeNull();
  });

  it("matches the real size when the HASH segment happens to contain a size literal", () => {
    // HASH starts with "Th" but the real size is M. The rewrite should target
    // the actual size segment, not the hash literal.
    const hashWithTh = "https://photos.smugmug.com/photos/i-abc123/0/ThXyZAbCdE/M/i-abc123-M.jpg";
    expect(smugmugVariantUrl(hashWithTh, "XL")).toBe(
      "https://photos.smugmug.com/photos/i-abc123/0/ThXyZAbCdE/XL/i-abc123-XL.jpg",
    );
  });

  it("preserves the query string", () => {
    const input = `${BASE}/Th/i-abc123-Th.jpg?download=1&token=xyz`;
    expect(smugmugVariantUrl(input, "XL")).toBe(
      `${BASE}/XL/i-abc123-XL.jpg?download=1&token=xyz`,
    );
  });

  it("returns null when the path-size and filename-size disagree", () => {
    // Defensive: a malformed URL where the two size tokens mismatch must not
    // be silently rewritten — caller falls back to the original.
    const mismatched = `${BASE}/M/i-abc123-Th.jpg`;
    expect(smugmugVariantUrl(mismatched, "XL")).toBeNull();
  });

  describe("production camera-filename shape (size D)", () => {
    const PROD =
      "https://photos.smugmug.com/IDTC/UW/2026/August10August142026/i-xxBqhHs/0/NXM2rNZgqhBrw9NBMCkSq3GpLSXFdzF3SX5cxGzNn";
    const archived = `${PROD}/D/IMG_5244-D.jpg`;

    it.each(["M", "L", "XL"] as const)("rewrites a D archive URL to %s", (size) => {
      expect(smugmugVariantUrl(archived, size)).toBe(`${PROD}/${size}/IMG_5244-${size}.jpg`);
    });

    it("rewrites a camera-filename Th thumbnail to XL", () => {
      expect(smugmugVariantUrl(`${PROD}/Th/IMG_5244-Th.jpg`, "XL")).toBe(
        `${PROD}/XL/IMG_5244-XL.jpg`,
      );
    });

    it("is idempotent for a camera-filename URL already at the target size", () => {
      const input = `${PROD}/L/IMG_5244-L.jpg`;
      expect(smugmugVariantUrl(input, "L")).toBe(input);
    });

    it("preserves the query string", () => {
      expect(smugmugVariantUrl(`${archived}?v=2`, "XL")).toBe(`${PROD}/XL/IMG_5244-XL.jpg?v=2`);
    });

    it("handles stems containing -, _, . and URL-encoded spaces", () => {
      for (const stem of ["IMG-5244", "DSC_0001", "photo.v2", "Camp%20Day%201", "a-D"]) {
        expect(smugmugVariantUrl(`${PROD}/D/${stem}-D.JPG`, "XL")).toBe(
          `${PROD}/XL/${stem}-XL.JPG`,
        );
      }
    });

    it("returns null when the path-size and filename-size disagree", () => {
      expect(smugmugVariantUrl(`${PROD}/D/IMG_5244-L.jpg`, "XL")).toBeNull();
    });

    it("returns null for a filename with no size suffix", () => {
      expect(smugmugVariantUrl(`${PROD}/D/IMG_5244.jpg`, "XL")).toBeNull();
    });
  });
});
