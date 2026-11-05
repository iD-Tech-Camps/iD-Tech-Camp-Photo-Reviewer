// Pure pieces of the AI photo-search pipeline: the Gemini prompt + response
// schema, validation/normalization of the model's JSON, and the text "search
// document" that gets embedded. No network or DB access, so it's unit-tested
// directly (tests/unit/ai-photo-metadata.test.ts).
//
// Bump PROMPT_VERSION whenever the prompt or schema changes meaningfully; it's
// stored on every row so photos can be re-tagged selectively later.

export const PROMPT_VERSION = 2;

export const PEOPLE_BUCKETS = ["0", "1", "2", "3-5", "6-15", "16+"] as const;
export type PeopleBucket = (typeof PEOPLE_BUCKETS)[number];

export const SHOT_TYPES = ["close_up", "medium", "group", "wide", "detail", "screen", "other"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const PHOTO_QUALITIES = ["good", "ok", "poor"] as const;
export type PhotoQuality = (typeof PHOTO_QUALITIES)[number];

export type ApparentGenders = { girls: number; boys: number; women: number; men: number; unclear: number };

export type PhotoMetadata = {
  caption: string;
  people_count_bucket: PeopleBucket;
  apparent_genders: ApparentGenders;
  shot_type: ShotType;
  activities: string[];
  objects: string[];
  technology: string[];
  setting: string[];
  mood: string[];
  keywords: string[];
  photo_quality: PhotoQuality;
};

/** Where the photo was taken — fed to the prompt and the search document. */
export type PhotoContext = {
  divisionName?: string | null;
  locationName?: string | null;
  weekName?: string | null;
};

const stringArray = (description?: string) => ({
  type: "array",
  items: { type: "string" },
  ...(description ? { description } : {}),
});

/** JSON Schema passed to Gemini as `responseJsonSchema`. */
export const METADATA_JSON_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string", description: "2-4 sentence factual description of the scene for search." },
    people_count_bucket: { type: "string", enum: [...PEOPLE_BUCKETS] },
    apparent_genders: {
      type: "object",
      description:
        "Counts of clearly visible people by apparent gender. Campers = kids/teens; adults = instructors/staff/visitors. " +
        "Use 'unclear' when you can't tell. Counts should sum to roughly the number of visible people; estimate for crowds.",
      properties: {
        girls: { type: "integer" },
        boys: { type: "integer" },
        women: { type: "integer" },
        men: { type: "integer" },
        unclear: { type: "integer" },
      },
      required: ["girls", "boys", "women", "men", "unclear"],
    },
    shot_type: { type: "string", enum: [...SHOT_TYPES] },
    activities: stringArray(),
    objects: stringArray(),
    technology: stringArray("Specific tech visible: devices, kits, software on screen. Empty if none."),
    setting: stringArray(),
    mood: stringArray(),
    keywords: stringArray("30-60 search terms incl. synonyms."),
    photo_quality: { type: "string", enum: [...PHOTO_QUALITIES] },
  },
  required: [
    "caption", "people_count_bucket", "apparent_genders", "shot_type", "activities", "objects",
    "technology", "setting", "mood", "keywords", "photo_quality",
  ],
} as const;

export function buildTaggingPrompt(ctx: PhotoContext): string {
  const where = [
    ctx.divisionName ?? "iD Tech",
    ctx.locationName ? `at ${ctx.locationName}` : null,
    ctx.weekName ? `week of ${ctx.weekName}` : null,
  ].filter(Boolean).join(", ");
  return `You are cataloguing photos from iD Tech summer tech camps so staff can find them by text search.
Context: ${where}.
Describe only what is visible. Rules:
- Never name or identify anyone, and never describe ethnicity or attractiveness. Use role terms like "camper" and "instructor" ("instructor in staff shirt"). Apparent gender is fine and useful ("two girls", "a boy and a girl", "a female instructor"); use "camper" when it isn't clear.
- Name specific technology (e.g. "VEX robot", "LEGO Spike", "Minecraft on laptop", "3D printer", "VR headset") only when it is clearly visible; never guess brands or software you can't see.
- Keywords must be things actually supported by the image (no speculative terms like "parents" or "coding" unless visible). Include synonyms (robot / robotics), actions, objects, and setting.
- photo_quality: "poor" if blurry, very dark, or subject cut off.`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const MAX_LIST = 80;
const MAX_ITEM_LEN = 80;

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const s = v.trim().replace(/\s+/g, " ").slice(0, MAX_ITEM_LEN);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 500) : 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Validate + normalize the model's JSON. Structured output makes the shape
 * reliable, but we still trim, de-duplicate, clamp counts, and coerce unknown
 * enum values so one odd response can't break inserts. Throws only when the
 * response is unusable (not an object, or no caption).
 */
export function parsePhotoMetadata(raw: unknown): PhotoMetadata {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("metadata is not an object");
  }
  const o = obj as Record<string, unknown>;
  const caption = typeof o.caption === "string" ? o.caption.trim() : "";
  if (!caption) throw new Error("metadata has no caption");

  const g = (o.apparent_genders ?? {}) as Record<string, unknown>;
  return {
    caption: caption.slice(0, 2000),
    people_count_bucket: oneOf(o.people_count_bucket, PEOPLE_BUCKETS, "0"),
    apparent_genders: {
      girls: count(g.girls),
      boys: count(g.boys),
      women: count(g.women),
      men: count(g.men),
      unclear: count(g.unclear),
    },
    shot_type: oneOf(o.shot_type, SHOT_TYPES, "other"),
    activities: cleanList(o.activities),
    objects: cleanList(o.objects),
    technology: cleanList(o.technology),
    setting: cleanList(o.setting),
    mood: cleanList(o.mood),
    keywords: cleanList(o.keywords),
    photo_quality: oneOf(o.photo_quality, PHOTO_QUALITIES, "ok"),
  };
}

// ─── Search document ────────────────────────────────────────────────────────

const GENDER_LABELS: [keyof ApparentGenders, string, string][] = [
  ["girls", "girl", "girls"],
  ["boys", "boy", "boys"],
  ["women", "woman", "women"],
  ["men", "man", "men"],
];

export function describeGenders(g: ApparentGenders): string {
  const parts = GENDER_LABELS
    .filter(([k]) => g[k] > 0)
    .map(([k, one, many]) => `${g[k]} ${g[k] === 1 ? one : many}`);
  return parts.length ? parts.join(", ") : "none clearly visible";
}

const join = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

/**
 * The text that gets embedded for semantic search: the caption first (most
 * weight), then the structured fields and keywords, then where/when.
 */
export function buildSearchDocument(m: PhotoMetadata, ctx: PhotoContext): string {
  return [
    m.caption,
    `People: ${m.people_count_bucket}. Apparent genders: ${describeGenders(m.apparent_genders)}. Shot: ${m.shot_type.replace("_", " ")}.`,
    `Activities: ${join(m.activities)}.`,
    `Technology: ${join(m.technology)}.`,
    `Objects: ${join(m.objects)}.`,
    `Setting: ${join(m.setting)}. Mood: ${join(m.mood)}.`,
    `Keywords: ${join(m.keywords)}.`,
    [ctx.divisionName, ctx.locationName, ctx.weekName].filter(Boolean).join(" — "),
  ].filter(Boolean).join("\n");
}

/** pgvector text literal for an embedding: '[0.1,0.2,...]'. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

/** Row shape for public.photo_ai_metadata (status 'done'). */
export function toMetadataRow(
  photoId: string,
  m: PhotoMetadata,
  opts: { model: string; textEmbedding: number[]; imageEmbedding: number[] | null },
) {
  return {
    photo_id: photoId,
    status: "done" as const,
    last_error: null,
    caption: m.caption,
    people_count_bucket: m.people_count_bucket,
    girls: m.apparent_genders.girls,
    boys: m.apparent_genders.boys,
    women: m.apparent_genders.women,
    men: m.apparent_genders.men,
    gender_unclear: m.apparent_genders.unclear,
    shot_type: m.shot_type,
    photo_quality: m.photo_quality,
    activities: m.activities,
    objects: m.objects,
    technology: m.technology,
    setting: m.setting,
    mood: m.mood,
    keywords: m.keywords,
    text_embedding: toVectorLiteral(opts.textEmbedding),
    image_embedding: opts.imageEmbedding ? toVectorLiteral(opts.imageEmbedding) : null,
    model: opts.model,
    prompt_version: PROMPT_VERSION,
    updated_at: new Date().toISOString(),
  };
}
