"use client";

import React from "react";

export const SCREEN_PARAM = "s";

/** Internal screen id → URL slug (only where they differ). */
const SCREEN_TO_URL_SLUG: Record<string, string> = {
  triage: "camp-quality",
};

/** URL slug → internal screen id. Includes legacy aliases. */
const URL_SLUG_TO_SCREEN: Record<string, string> = {
  "camp-quality": "triage",
  triage: "triage",
};

export function screenToUrlSlug(screen: string): string {
  return SCREEN_TO_URL_SLUG[screen] ?? screen;
}

export function urlSlugToScreen(slug: string | null): string | null {
  if (!slug) return null;
  return URL_SLUG_TO_SCREEN[slug] ?? slug;
}

export const SUBVIEW_PARAMS = {
  week: "week",
  claim: "claim",
  lead: "lead",
} as const;

export function readSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function replaceSearchParams(mutate: (params: URLSearchParams) => void) {
  if (typeof window === "undefined") return;
  const params = readSearchParams();
  mutate(params);
  const qs = params.toString();
  const path = window.location.pathname;
  window.history.replaceState(null, "", qs ? `${path}?${qs}` : path);
}

export function getScreenFromUrl(): string | null {
  return readSearchParams().get(SCREEN_PARAM);
}

export function syncScreenToUrl(screen: string) {
  replaceSearchParams((p) => {
    p.set(SCREEN_PARAM, screenToUrlSlug(screen));
    for (const key of Object.values(SUBVIEW_PARAMS)) {
      p.delete(key);
    }
  });
}

/** Sidebar navigation — always opens the section hub, not a remembered sub-view. */
export function navigateToMainScreen(screen: string) {
  syncScreenToUrl(screen);
}

export function clearSubViewParams() {
  replaceSearchParams((p) => {
    for (const key of Object.values(SUBVIEW_PARAMS)) {
      p.delete(key);
    }
  });
}

export type TriageView =
  | { kind: "hub" }
  | { kind: "claim"; claimId: string; campWeekId: string }
  | { kind: "senior"; campWeekId: string };

export type PhotoRatingView =
  | { kind: "hub" }
  | { kind: "claim"; claimId: string; campWeekId: string };

export type SeniorReviewView =
  | { kind: "hub" }
  | { kind: "week"; campWeekId: string };

export function parseTriageViewFromUrl(): TriageView | null {
  const p = readSearchParams();
  const claim = p.get(SUBVIEW_PARAMS.claim);
  const week = p.get(SUBVIEW_PARAMS.week);
  const lead = p.get(SUBVIEW_PARAMS.lead);
  if (claim && week) return { kind: "claim", claimId: claim, campWeekId: week };
  if (lead) return { kind: "senior", campWeekId: lead };
  return null;
}

export function writeTriageViewToUrl(view: TriageView) {
  replaceSearchParams((p) => {
    p.set(SCREEN_PARAM, screenToUrlSlug("triage"));
    p.delete(SUBVIEW_PARAMS.claim);
    p.delete(SUBVIEW_PARAMS.week);
    p.delete(SUBVIEW_PARAMS.lead);
    if (view.kind === "claim") {
      p.set(SUBVIEW_PARAMS.claim, view.claimId);
      p.set(SUBVIEW_PARAMS.week, view.campWeekId);
    } else if (view.kind === "senior") {
      p.set(SUBVIEW_PARAMS.lead, view.campWeekId);
    }
  });
}

export function parsePhotoRatingViewFromUrl(): PhotoRatingView | null {
  const p = readSearchParams();
  const claim = p.get(SUBVIEW_PARAMS.claim);
  const week = p.get(SUBVIEW_PARAMS.week);
  if (claim && week) return { kind: "claim", claimId: claim, campWeekId: week };
  return null;
}

export function writePhotoRatingViewToUrl(view: PhotoRatingView) {
  replaceSearchParams((p) => {
    p.set(SCREEN_PARAM, "photo-rating");
    p.delete(SUBVIEW_PARAMS.claim);
    p.delete(SUBVIEW_PARAMS.week);
    p.delete(SUBVIEW_PARAMS.lead);
    if (view.kind === "claim") {
      p.set(SUBVIEW_PARAMS.claim, view.claimId);
      p.set(SUBVIEW_PARAMS.week, view.campWeekId);
    }
  });
}

export function parseSeniorReviewViewFromUrl(): SeniorReviewView | null {
  const week = readSearchParams().get(SUBVIEW_PARAMS.week);
  if (week) return { kind: "week", campWeekId: week };
  return null;
}

export function writeSeniorReviewViewToUrl(view: SeniorReviewView) {
  replaceSearchParams((p) => {
    p.set(SCREEN_PARAM, "senior-review");
    p.delete(SUBVIEW_PARAMS.claim);
    p.delete(SUBVIEW_PARAMS.week);
    p.delete(SUBVIEW_PARAMS.lead);
    if (view.kind === "week") p.set(SUBVIEW_PARAMS.week, view.campWeekId);
  });
}

function inferScreenFromSubViewParams(params: URLSearchParams): string | null {
  if (params.get(SUBVIEW_PARAMS.lead)) return "triage";
  if (params.get(SUBVIEW_PARAMS.claim) && params.get(SUBVIEW_PARAMS.week)) return null;
  if (params.get(SUBVIEW_PARAMS.week)) return "senior-review";
  return null;
}

export function resolvePersistedScreen(
  params: URLSearchParams,
  validScreens: readonly string[],
  savedScreen: string | null,
): string {
  const fromUrl = urlSlugToScreen(params.get(SCREEN_PARAM));
  if (fromUrl && validScreens.includes(fromUrl)) return fromUrl;
  const inferred = inferScreenFromSubViewParams(params);
  if (inferred && validScreens.includes(inferred)) return inferred;
  if (savedScreen && validScreens.includes(savedScreen)) return savedScreen;
  return "triage";
}

export function readPersistedScreen(validScreens: readonly string[]): string {
  if (typeof window === "undefined") return "triage";
  return resolvePersistedScreen(
    readSearchParams(),
    validScreens,
    localStorage.getItem("screen"),
  );
}

export function usePersistedView<T extends { kind: string }>(
  parse: () => T | null,
  write: (view: T) => void,
  defaultView: T,
) {
  const [view, setViewState] = React.useState<T>(() => parse() ?? defaultView);

  React.useEffect(() => {
    const parsed = parse();
    if (parsed) setViewState(parsed);
  }, [parse]);

  const setView = React.useCallback(
    (next: T) => {
      setViewState(next);
      write(next);
    },
    [write],
  );

  return [view, setView] as const;
}
