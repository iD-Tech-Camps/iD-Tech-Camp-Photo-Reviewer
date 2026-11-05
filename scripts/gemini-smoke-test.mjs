// Smoke test: send one SmugMug photo to Gemini Flash and print structured
// search metadata + token usage. Does not touch the database.
//
//   node scripts/gemini-smoke-test.mjs <smugmug image url> [context hint]
//
// Reads GEMINI_API_KEY (and optional GEMINI_MODEL) from .env.development.local.

import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";

config({ path: ".env.development.local", quiet: true });

const [rawUrl, context = ""] = process.argv.slice(2);
if (!rawUrl) {
  console.error("Usage: node scripts/gemini-smoke-test.mjs <image url> [context hint]");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY missing from .env.development.local");
  process.exit(1);
}

// Prod URLs end in /D/IMG_1234-D.jpg (or another size token). Rewrite to the
// ~140 KB "M" variant so we don't upload the multi-MB original.
const imageUrl = rawUrl.replace(/\/(Ti|Th|S|M|L|XL|X2|X3|X4|X5|O|D)\/([^/]+)-\1(\.\w+)(\?.*)?$/, "/M/$2-M$3$4");

const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const schema = {
  type: "object",
  properties: {
    caption: { type: "string", description: "2-4 sentence factual description of the scene for search." },
    people_count: { type: "integer", description: "Number of people clearly visible; 0 if none." },
    shot_type: { type: "string", enum: ["close_up", "medium", "group", "wide", "detail", "screen"] },
    activities: { type: "array", items: { type: "string" } },
    objects: { type: "array", items: { type: "string" } },
    setting: { type: "array", items: { type: "string" } },
    mood: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" }, description: "30-60 search terms incl. synonyms and specific product/brand names." },
  },
  required: ["caption", "people_count", "shot_type", "activities", "objects", "setting", "mood", "keywords"],
};

const prompt = `You are cataloguing photos from iD Tech summer tech camps so staff can find them by text search.
${context ? `Context: ${context}\n` : ""}Describe only what is visible. Rules:
- Never name, identify, or guess the identity, ethnicity, or appearance-based traits of anyone. Use neutral terms like "camper", "instructor", "group of campers".
- Be specific about technology (e.g. "VEX robot", "LEGO Spike", "Minecraft on laptop", "3D printer") when it is clearly visible; do not guess brands you can't see.
- Keywords should maximize findability: include synonyms (robot / robotics / build), actions, and objects.`;

const t0 = Date.now();
const imgRes = await fetch(imageUrl);
if (!imgRes.ok) {
  console.error(`Image fetch failed: ${imgRes.status} ${imageUrl}`);
  process.exit(1);
}
const img = Buffer.from(await imgRes.arrayBuffer());
const t1 = Date.now();

const res = await ai.models.generateContent({
  model,
  contents: [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: imgRes.headers.get("content-type") ?? "image/jpeg", data: img.toString("base64") } },
        { text: prompt },
      ],
    },
  ],
  config: { responseMimeType: "application/json", responseJsonSchema: schema },
});
const t2 = Date.now();

console.log(`image:   ${imageUrl} (${Math.round(img.length / 1024)} KB, fetched in ${t1 - t0} ms)`);
console.log(`model:   ${model} -> ${res.modelVersion ?? "?"} (${t2 - t1} ms)`);
console.log(`usage:   ${JSON.stringify(res.usageMetadata)}`);
console.log("\nmetadata:");
console.log(JSON.stringify(JSON.parse(res.text), null, 2));
