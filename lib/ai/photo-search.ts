import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUERY_MODEL, ThinkingLevel, embedQuery, gemini, withRetry } from "@/lib/ai/gemini";
import { toVectorLiteral } from "@/lib/ai/photo-metadata";
import {
  QUERY_JSON_SCHEMA,
  buildQueryPrompt,
  mergeFilters,
  parseInterpretedQuery,
  toSearchRpcArgs,
  type InterpretedQuery,
  type SearchFilters,
} from "@/lib/ai/search-query";

/**
 * Optional relevance floor on the best embedding similarity. Off by default:
 * on the 199-photo prototype, absolute similarity didn't separate hits from
 * misses ("3D printer" had a true match at 0.345; "VR headsets" had none yet
 * topped 0.426 — short queries simply score lower). Callers get
 * text_similarity / image_similarity / keyword_match per result to judge
 * confidence instead. Set AI_SEARCH_MIN_SIMILARITY or pass minSimilarity to
 * enable a floor.
 */
const envFloor = Number(process.env.AI_SEARCH_MIN_SIMILARITY);
export const DEFAULT_MIN_SIMILARITY: number | null = Number.isFinite(envFloor) && envFloor > 0 ? envFloor : null;

export async function interpretQuery(query: string): Promise<InterpretedQuery> {
  try {
    const res = await withRetry(() =>
      gemini().models.generateContent({
        model: QUERY_MODEL,
        contents: [{ role: "user", parts: [{ text: buildQueryPrompt(query) }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: QUERY_JSON_SCHEMA,
          // MINIMAL is rejected by gemini-3.8-flash (400); LOW adds no
          // thinking tokens in practice.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
    2);
    return parseInterpretedQuery(res.text ?? "", query);
  } catch (e) {
    // Interpretation is a nicety; plain semantic search still works without
    // it — but log, so a persistent failure doesn't go unnoticed.
    console.warn("[ai-search] query interpretation failed; searching raw query:", e instanceof Error ? e.message : e);
    return { searchText: query, filters: {} };
  }
}

export type PhotoSearchRequest = {
  query: string;
  /** Explicit filters; override anything inferred from the query. */
  filters?: SearchFilters;
  /** Let Gemini extract filters (counts, genders, shot type) from the query. */
  interpret?: boolean;
  limit?: number;
  minSimilarity?: number | null;
};

export type PhotoSearchResult = {
  searchText: string;
  /** Filters actually applied. */
  filters: SearchFilters;
  /** Filters the model inferred from the query (before any relaxing). */
  inferredFilters: SearchFilters;
  /**
   * True when the inferred filters matched nothing and the results come from
   * a retry with only the caller's explicit filters ("close-up of a 3D
   * printer" → no close-ups, but here's the 3D printer).
   */
  relaxed: boolean;
  results: Record<string, unknown>[];
};

export async function searchPhotos(supabase: SupabaseClient, req: PhotoSearchRequest): Promise<PhotoSearchResult> {
  const interpreted = req.interpret === false
    ? { searchText: req.query, filters: {} }
    : await interpretQuery(req.query);
  const explicit = req.filters ?? {};
  const filters = mergeFilters(interpreted.filters, explicit);
  const embedding = toVectorLiteral(await embedQuery(interpreted.searchText));

  const minSimilarity = req.minSimilarity === undefined ? DEFAULT_MIN_SIMILARITY : req.minSimilarity;
  const limit = Math.min(Math.max(req.limit ?? 24, 1), 100);
  const run = async (f: SearchFilters) => {
    const { data, error } = await supabase.rpc(
      "photo_ai_search",
      toSearchRpcArgs(embedding, interpreted.searchText, f, limit, minSimilarity),
    );
    if (error) throw new Error(`photo_ai_search: ${error.message}`);
    return (data ?? []) as Record<string, unknown>[];
  };

  const results = await run(filters);
  if (results.length === 0 && Object.keys(interpreted.filters).length > 0) {
    const relaxed = await run(explicit);
    if (relaxed.length > 0) {
      return { searchText: interpreted.searchText, filters: explicit, inferredFilters: interpreted.filters, relaxed: true, results: relaxed };
    }
  }
  return { searchText: interpreted.searchText, filters, inferredFilters: interpreted.filters, relaxed: false, results };
}
