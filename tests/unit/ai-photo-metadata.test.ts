import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  buildSearchDocument,
  buildTaggingPrompt,
  describeGenders,
  parsePhotoMetadata,
  toMetadataRow,
  toVectorLiteral,
} from "@/lib/ai/photo-metadata";
import {
  mergeFilters,
  normalizeFilters,
  parseInterpretedQuery,
  toSearchRpcArgs,
} from "@/lib/ai/search-query";

const valid = {
  caption: "Two girls assemble a VEX robot at a classroom table.",
  people_count_bucket: "2",
  apparent_genders: { girls: 2, boys: 0, women: 0, men: 0, unclear: 0 },
  shot_type: "medium",
  activities: ["building", "robotics"],
  objects: ["robot", "table"],
  technology: ["VEX IQ robot"],
  setting: ["classroom", "indoor"],
  mood: ["focused"],
  keywords: ["robot", "robotics", "VEX", "teamwork"],
  photo_quality: "good",
};

describe("parsePhotoMetadata", () => {
  it("accepts a well-formed response (object or JSON string)", () => {
    expect(parsePhotoMetadata(valid)).toEqual(valid);
    expect(parsePhotoMetadata(JSON.stringify(valid))).toEqual(valid);
  });

  it("trims, de-duplicates case-insensitively, and drops non-strings in lists", () => {
    const m = parsePhotoMetadata({ ...valid, keywords: [" Robot ", "robot", "ROBOT", 7, "", "VEX  IQ"] });
    expect(m.keywords).toEqual(["Robot", "VEX IQ"]);
  });

  it("coerces unknown enum values to safe fallbacks", () => {
    const m = parsePhotoMetadata({ ...valid, people_count_bucket: "lots", shot_type: "aerial", photo_quality: "great" });
    expect(m.people_count_bucket).toBe("0");
    expect(m.shot_type).toBe("other");
    expect(m.photo_quality).toBe("ok");
  });

  it("clamps gender counts to non-negative integers and defaults missing ones to 0", () => {
    const m = parsePhotoMetadata({ ...valid, apparent_genders: { girls: 2.6, boys: -3, women: "1", men: null } });
    expect(m.apparent_genders).toEqual({ girls: 3, boys: 0, women: 1, men: 0, unclear: 0 });
  });

  it("defaults missing lists to empty", () => {
    const { activities: _a, technology: _t, ...rest } = valid;
    const m = parsePhotoMetadata(rest);
    expect(m.activities).toEqual([]);
    expect(m.technology).toEqual([]);
  });

  it("rejects responses with no caption or that aren't objects", () => {
    expect(() => parsePhotoMetadata({ ...valid, caption: "  " })).toThrow(/caption/);
    expect(() => parsePhotoMetadata([valid])).toThrow(/object/);
    expect(() => parsePhotoMetadata("not json")).toThrow();
  });
});

describe("prompt + search document", () => {
  it("puts location context in the prompt and allows apparent gender", () => {
    const p = buildTaggingPrompt({ divisionName: "iD Tech Camps", locationName: "UW Seattle", weekName: "Aug 10 - Aug 14" });
    expect(p).toContain("iD Tech Camps, at UW Seattle, week of Aug 10 - Aug 14");
    expect(p).toMatch(/Apparent gender is fine/);
    expect(p).toMatch(/never describe ethnicity/);
  });

  it("describes genders with singular/plural and a none case", () => {
    expect(describeGenders({ girls: 1, boys: 2, women: 0, men: 1, unclear: 4 })).toBe("1 girl, 2 boys, 1 man");
    expect(describeGenders({ girls: 0, boys: 0, women: 0, men: 0, unclear: 3 })).toBe("none clearly visible");
  });

  it("leads the search document with the caption and includes fields + context", () => {
    const doc = buildSearchDocument(parsePhotoMetadata(valid), { locationName: "UW Seattle", weekName: "Aug 10" });
    expect(doc.split("\n")[0]).toBe(valid.caption);
    expect(doc).toContain("Apparent genders: 2 girls");
    expect(doc).toContain("Technology: VEX IQ robot.");
    expect(doc).toContain("UW Seattle — Aug 10");
  });

  it("builds a DB row with pgvector literals and the prompt version", () => {
    const row = toMetadataRow("p1", parsePhotoMetadata(valid), { model: "m", textEmbedding: [0.5, -1], imageEmbedding: null });
    expect(row).toMatchObject({ photo_id: "p1", status: "done", girls: 2, gender_unclear: 0, text_embedding: "[0.5,-1]", image_embedding: null, prompt_version: PROMPT_VERSION });
    expect(toVectorLiteral([1, 2.5])).toBe("[1,2.5]");
  });
});

describe("search query handling", () => {
  const LOC = "11111111-2222-3333-4444-555555555555";

  it("normalizes filters from model (snake_case) and caller (camelCase) shapes", () => {
    expect(normalizeFilters({ people: ["2", "bogus"], min_girls: 2, shot_types: ["close_up"], season: 2026 }))
      .toEqual({ people: ["2"], minGirls: 2, shotTypes: ["close_up"], season: 2026 });
    expect(normalizeFilters({ locationId: LOC, minWomen: "1", includePoor: true }))
      .toEqual({ locationId: LOC, minWomen: 1, includePoor: true });
  });

  it("drops invalid values instead of passing them to the RPC", () => {
    expect(normalizeFilters({ locationId: "nope", min_girls: 0, season: 1850, people: [] })).toEqual({});
    expect(normalizeFilters(null)).toEqual({});
  });

  it("falls back to the raw query when the model output is unusable", () => {
    expect(parseInterpretedQuery("{{bad", "kids on laptops")).toEqual({ searchText: "kids on laptops", filters: {} });
    expect(parseInterpretedQuery({ search_text: "" }, "q")).toEqual({ searchText: "q", filters: {} });
  });

  it("lets explicit filters override inferred ones", () => {
    expect(mergeFilters({ minGirls: 1, people: ["2"] }, { minGirls: 3 })).toEqual({ minGirls: 3, people: ["2"] });
  });

  it("maps filters to photo_ai_search arguments with nulls for unset", () => {
    const args = toSearchRpcArgs("[1]", "robots", { minGirls: 2, people: ["2"] }, 24, null);
    expect(args).toMatchObject({ p_embedding: "[1]", p_query: "robots", p_min_girls: 2, p_people: ["2"], p_season: null, p_include_poor: false, p_min_similarity: null });
  });
});
