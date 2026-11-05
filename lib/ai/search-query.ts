// Turning a natural-language photo request into search text + structured
// filters. Gemini does the interpretation (QUERY_JSON_SCHEMA); this module owns
// the schema, the prompt, and validation, and merges explicit caller filters
// on top (explicit always wins). Pure — unit-tested.

import { PEOPLE_BUCKETS, SHOT_TYPES, type PeopleBucket, type ShotType } from "@/lib/ai/photo-metadata";

export type SearchFilters = {
  season?: number | null;
  divisionId?: string | null;
  locationId?: string | null;
  campWeekId?: string | null;
  people?: PeopleBucket[] | null;
  shotTypes?: ShotType[] | null;
  minGirls?: number | null;
  minBoys?: number | null;
  minWomen?: number | null;
  minMen?: number | null;
  includePoor?: boolean;
};

export type InterpretedQuery = { searchText: string; filters: SearchFilters };

export const QUERY_JSON_SCHEMA = {
  type: "object",
  properties: {
    search_text: {
      type: "string",
      description: "The visual content to search for, rephrased as a short scene description. Drop counts/genders/years that are captured as filters below, but keep them if they're descriptive.",
    },
    people: { type: "array", items: { type: "string", enum: [...PEOPLE_BUCKETS] }, description: "Only if the request specifies how many people. Include every bucket that satisfies it." },
    shot_types: { type: "array", items: { type: "string", enum: [...SHOT_TYPES] }, description: "Only if the request asks for a kind of shot (close-up, group photo, wide shot, screen)." },
    min_girls: { type: "integer", description: "Only if the request asks for girls (e.g. 'two girls' -> 2, 'girls' -> 1)." },
    min_boys: { type: "integer" },
    min_women: { type: "integer", description: "Adult women, e.g. 'female instructor' -> 1." },
    min_men: { type: "integer" },
    season: { type: "integer", description: "Only if the request names a year/season." },
  },
  required: ["search_text"],
} as const;

export function buildQueryPrompt(query: string): string {
  return `You turn requests for iD Tech camp photos into a search. Campers are kids/teens; instructors are adults.
Extract filters ONLY when the request clearly states them; otherwise leave them out. Never invent constraints.
Examples:
- "two kids working on a robotics project" -> search_text "two campers working together on a robotics project", people ["2"]
- "girls coding" -> search_text "girls coding on laptops", min_girls 1
- "female instructor teaching" -> search_text "female instructor teaching campers", min_women 1
- "close-up of hands building LEGO" -> search_text "close-up of hands building with LEGO", shot_types ["close_up","detail"]
Request: ${JSON.stringify(query)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function minCount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? Math.min(n, 50) : null;
}

function enumList<T extends string>(v: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.filter((x): x is T => typeof x === "string" && (allowed as readonly string[]).includes(x)))];
  return out.length ? out : null;
}

function uuid(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}

function season(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

/** Validate filters from either the model (snake_case) or an API caller (camelCase). */
export function normalizeFilters(raw: unknown): SearchFilters {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => r[camel] ?? r[snake];
  const f: SearchFilters = {
    season: season(pick("season", "season")),
    divisionId: uuid(pick("divisionId", "division_id")),
    locationId: uuid(pick("locationId", "location_id")),
    campWeekId: uuid(pick("campWeekId", "camp_week_id")),
    people: enumList(pick("people", "people"), PEOPLE_BUCKETS),
    shotTypes: enumList(pick("shotTypes", "shot_types"), SHOT_TYPES),
    minGirls: minCount(pick("minGirls", "min_girls")),
    minBoys: minCount(pick("minBoys", "min_boys")),
    minWomen: minCount(pick("minWomen", "min_women")),
    minMen: minCount(pick("minMen", "min_men")),
  };
  const includePoor = pick("includePoor", "include_poor");
  if (typeof includePoor === "boolean") f.includePoor = includePoor;
  // Drop nulls so merging doesn't clobber.
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)) as SearchFilters;
}

/** Parse the model's JSON. Falls back to the raw query with no filters. */
export function parseInterpretedQuery(raw: unknown, originalQuery: string): InterpretedQuery {
  try {
    const obj = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
    const text = typeof obj?.search_text === "string" && obj.search_text.trim() ? obj.search_text.trim() : originalQuery;
    return { searchText: text.slice(0, 500), filters: normalizeFilters(obj) };
  } catch {
    return { searchText: originalQuery, filters: {} };
  }
}

/** Explicit caller filters override anything the model inferred. */
export function mergeFilters(inferred: SearchFilters, explicit: SearchFilters): SearchFilters {
  return { ...inferred, ...explicit };
}

/** Arguments for public.photo_ai_search. */
export function toSearchRpcArgs(
  embedding: string,
  query: string,
  f: SearchFilters,
  limit: number,
  minSimilarity: number | null,
) {
  return {
    p_embedding: embedding,
    p_query: query,
    p_limit: limit,
    p_season: f.season ?? null,
    p_division_id: f.divisionId ?? null,
    p_location_id: f.locationId ?? null,
    p_camp_week_id: f.campWeekId ?? null,
    p_people: f.people ?? null,
    p_shot_types: f.shotTypes ?? null,
    p_min_girls: f.minGirls ?? null,
    p_min_boys: f.minBoys ?? null,
    p_min_women: f.minWomen ?? null,
    p_min_men: f.minMen ?? null,
    p_include_poor: f.includePoor ?? false,
    p_min_similarity: minSimilarity,
  };
}
