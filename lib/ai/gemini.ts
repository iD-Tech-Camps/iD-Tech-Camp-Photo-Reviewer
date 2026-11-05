import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { missingEnvVars } from "@/lib/server-env";
import {
  METADATA_JSON_SCHEMA,
  buildTaggingPrompt,
  parsePhotoMetadata,
  type PhotoContext,
  type PhotoMetadata,
} from "@/lib/ai/photo-metadata";

// Pinned rather than "gemini-flash-latest" so a silent model upgrade can't
// change tagging mid-backfill; the model is stored on every row.
export const TAGGING_MODEL = process.env.GEMINI_TAGGING_MODEL?.trim() || "gemini-3.8-flash";
export const QUERY_MODEL = process.env.GEMINI_QUERY_MODEL?.trim() || TAGGING_MODEL;
export const EMBEDDING_MODEL = "gemini-embedding-2";
/** Must match vector(768) in migration 20261105000054. */
export const EMBEDDING_DIMS = 768;

export const GEMINI_ENV_VARS = ["GEMINI_API_KEY"] as const;

let client: GoogleGenAI | null = null;
export function gemini(): GoogleGenAI {
  const missing = missingEnvVars(GEMINI_ENV_VARS);
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** Retry transient Gemini / network failures with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      const transient = (status != null && RETRYABLE.has(status)) || /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(String(e));
      if (!transient || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)));
    }
  }
}

export type DescribeResult = { metadata: PhotoMetadata; model: string; usage: unknown };

export async function describePhoto(image: Buffer, mimeType: string, ctx: PhotoContext): Promise<DescribeResult> {
  const res = await withRetry(() =>
    gemini().models.generateContent({
      model: TAGGING_MODEL,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: image.toString("base64") } },
          { text: buildTaggingPrompt(ctx) },
        ],
      }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: METADATA_JSON_SCHEMA,
        // Description doesn't benefit from reasoning; default thinking roughly
        // tripled output tokens in testing.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }),
  );
  if (!res.text) throw new Error(`empty response (finish: ${res.candidates?.[0]?.finishReason ?? "?"})`);
  return { metadata: parsePhotoMetadata(res.text), model: res.modelVersion ?? TAGGING_MODEL, usage: res.usageMetadata };
}

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/**
 * Embed texts, one vector per input. Each text MUST be its own Content
 * object: a bare string[] is merged into a single Content and comes back as
 * ONE vector (verified against gemini-embedding-2).
 */
export async function embedTexts(texts: string[], taskType: TaskType): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await withRetry(() =>
    gemini().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts.map((text) => ({ role: "user", parts: [{ text }] })),
      config: { taskType, outputDimensionality: EMBEDDING_DIMS },
    }),
  );
  const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMS)) {
    throw new Error(`embedTexts: expected ${texts.length}×${EMBEDDING_DIMS}, got ${vectors.length}×${vectors[0]?.length ?? 0}`);
  }
  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text], "RETRIEVAL_QUERY");
  return v;
}

/** Embed the image itself (multimodal), in the same space as text queries. */
export async function embedImage(image: Buffer, mimeType: string): Promise<number[]> {
  const res = await withRetry(() =>
    gemini().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: image.toString("base64") } }] }],
      config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: EMBEDDING_DIMS },
    }),
  );
  const v = res.embeddings?.[0]?.values ?? [];
  if (v.length !== EMBEDDING_DIMS) throw new Error(`embedImage: got ${v.length} dims`);
  return v;
}

export { ThinkingLevel };
