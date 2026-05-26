import { describe, expect, it } from "vitest";
import {
  resolvePersistedScreen,
  SCREEN_PARAM,
  screenToUrlSlug,
  SUBVIEW_PARAMS,
} from "@/lib/app-route";

const VALID = ["triage", "photo-rating", "senior-review", "my-stats"] as const;

describe("resolvePersistedScreen", () => {
  it("prefers the s query param", () => {
    const params = new URLSearchParams({ [SCREEN_PARAM]: "photo-rating" });
    expect(resolvePersistedScreen(params, VALID, null)).toBe("photo-rating");
  });

  it("maps camp-quality slug to triage", () => {
    const params = new URLSearchParams({ [SCREEN_PARAM]: "camp-quality" });
    expect(resolvePersistedScreen(params, VALID, null)).toBe("triage");
  });

  it("still accepts legacy triage slug", () => {
    const params = new URLSearchParams({ [SCREEN_PARAM]: "triage" });
    expect(resolvePersistedScreen(params, VALID, null)).toBe("triage");
  });

  it("infers senior-review from week param", () => {
    const params = new URLSearchParams({ [SUBVIEW_PARAMS.week]: "abc-123" });
    expect(resolvePersistedScreen(params, VALID, null)).toBe("senior-review");
  });

  it("falls back to saved screen", () => {
    expect(resolvePersistedScreen(new URLSearchParams(), VALID, "my-stats")).toBe("my-stats");
  });

  it("defaults to triage", () => {
    expect(resolvePersistedScreen(new URLSearchParams(), VALID, null)).toBe("triage");
  });
});

describe("screenToUrlSlug", () => {
  it("maps triage to camp-quality", () => {
    expect(screenToUrlSlug("triage")).toBe("camp-quality");
  });

  it("passes through other screens", () => {
    expect(screenToUrlSlug("photo-rating")).toBe("photo-rating");
  });
});
