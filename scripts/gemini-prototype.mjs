// AI search prototype: sample prod photos, describe them with Gemini Flash,
// embed, and run test queries. Reads prod (read-only); never writes to the DB.
// All data lands in .ai-proto/ (git-ignored).
//
//   node scripts/gemini-prototype.mjs sample [n=200]   pick photos across weeks/locations
//   node scripts/gemini-prototype.mjs tag              Gemini Flash -> structured metadata (resumable)
//   node scripts/gemini-prototype.mjs embed            text embeddings of metadata + image embeddings
//   node scripts/gemini-prototype.mjs search "query"   top results in the terminal
//   node scripts/gemini-prototype.mjs report           run QUERIES, write .ai-proto/report.html
//
// Env: GEMINI_API_KEY (.env.development.local); NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY for prod reads (.env.local). Optional GEMINI_MODEL,
// GEMINI_THINKING (MINIMAL|LOW|MEDIUM|HIGH, default LOW).

import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";

config({ path: ".env.development.local", quiet: true });
const prodEnv = config({ path: ".env.local", quiet: true, processEnv: {} }).parsed ?? {};

const DIR = ".ai-proto";
const F = {
  sample: path.join(DIR, "sample.json"),
  meta: path.join(DIR, "metadata.jsonl"),
  emb: path.join(DIR, "embeddings.json"),
  report: path.join(DIR, "report.html"),
};
fs.mkdirSync(DIR, { recursive: true });

const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
const THINKING = process.env.GEMINI_THINKING ?? "LOW";
const EMBED_MODEL = "gemini-embedding-2";
const DIMS = 768;
const PROMPT_VER = 2; // v2: apparent gender allowed (for representation/equity review)

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---------- helpers ----------

const sizeUrl = (url, size) =>
  url.replace(/\/(Ti|Th|S|M|L|XL|X2|X3|X4|X5|O|D)\/([^/]+)-\1(\.\w+)(\?.*)?$/, `/${size}/$2-${size}$3$4`);

async function prod(query, extraHeaders = {}) {
  const u = prodEnv.NEXT_PUBLIC_SUPABASE_URL, k = prodEnv.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${u}/rest/v1/${query}`, { headers: { apikey: k, Authorization: `Bearer ${k}`, ...extraHeaders } });
  if (!r.ok) throw new Error(`prod ${r.status}: ${await r.text()}`);
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.status ?? e?.code;
      const retryable = [429, 500, 502, 503, 504].includes(status) || /fetch failed|ECONNRESET|timeout/i.test(String(e));
      if (!retryable || attempt >= 5) throw e;
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`  ${label}: ${status ?? e.message} — retry ${attempt} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const loadSample = () => JSON.parse(fs.readFileSync(F.sample, "utf8"));

// ---------- sample ----------

const SKIP_DIVISIONS = /TEST|My SmugMug Creations|Next Folder|Photo Reviewer Collections|Other/i;

async function sample(n = 200) {
  const weeks = await (await prod(
    "camp_weeks?select=id,name,starts_on,locations(name,divisions(name)),photos(count)&limit=10000"
  )).json();
  const usable = weeks.filter((w) => w.photos?.[0]?.count >= 5 && !SKIP_DIVISIONS.test(w.locations?.divisions?.name ?? ""));
  // One week per location first (spread), then fill randomly.
  const byLoc = new Map();
  for (const w of shuffle(usable)) if (!byLoc.has(w.locations.name)) byLoc.set(w.locations.name, w);
  const perWeek = 3;
  const picked = [...byLoc.values()];
  for (const w of usable) { if (picked.length * perWeek >= n) break; if (!picked.includes(w)) picked.push(w); }
  picked.length = Math.ceil(n / perWeek);

  const out = [];
  await pool(picked, 6, async (w) => {
    const total = w.photos[0].count;
    const offsets = shuffle([...Array(total).keys()]).slice(0, perWeek);
    for (const off of offsets) {
      const [p] = await (await prod(
        `photos?select=id,image_url,captured_at&camp_week_id=eq.${w.id}&is_quarantined=eq.false&image_url=not.is.null&order=id&offset=${off}&limit=1`
      )).json();
      if (p) out.push({
        id: p.id, image_url: p.image_url, captured_at: p.captured_at,
        week: w.name, starts_on: w.starts_on, location: w.locations.name, division: w.locations.divisions?.name,
      });
    }
  });
  const final = out.slice(0, n);
  fs.writeFileSync(F.sample, JSON.stringify(final, null, 1));
  const locs = new Set(final.map((p) => p.location)).size;
  const years = [...new Set(final.map((p) => p.starts_on.slice(0, 4)))].sort();
  console.log(`sampled ${final.length} photos from ${picked.length} weeks, ${locs} locations, years ${years.join(", ")} -> ${F.sample}`);
}

// ---------- tag ----------

const SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string", description: "2-4 sentence factual description of the scene for search." },
    people_count_bucket: { type: "string", enum: ["0", "1", "2", "3-5", "6-15", "16+"] },
    apparent_genders: {
      type: "object",
      description: "Counts of clearly visible people by apparent gender. Campers = kids/teens; adults = instructors/staff/visitors. Use 'unclear' when you can't tell (back turned, partially visible). Counts should sum to roughly the number of visible people; for large crowds, estimate.",
      properties: {
        girls: { type: "integer" },
        boys: { type: "integer" },
        women: { type: "integer" },
        men: { type: "integer" },
        unclear: { type: "integer" },
      },
      required: ["girls", "boys", "women", "men", "unclear"],
    },
    shot_type: { type: "string", enum: ["close_up", "medium", "group", "wide", "detail", "screen", "other"] },
    activities: { type: "array", items: { type: "string" } },
    objects: { type: "array", items: { type: "string" } },
    technology: { type: "array", items: { type: "string" }, description: "Specific tech visible: devices, kits, software on screen. Empty if none." },
    setting: { type: "array", items: { type: "string" } },
    mood: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" }, description: "30-60 search terms incl. synonyms." },
    photo_quality: { type: "string", enum: ["good", "ok", "poor"] },
  },
  required: ["caption", "people_count_bucket", "apparent_genders", "shot_type", "activities", "objects", "technology", "setting", "mood", "keywords", "photo_quality"],
};

const promptFor = (p) => `You are cataloguing photos from iD Tech summer tech camps so staff can find them by text search.
Context: ${p.division ?? "iD Tech"} at ${p.location}, week of ${p.week}.
Describe only what is visible. Rules:
- Never name or identify anyone, and never describe ethnicity or attractiveness. Use role terms like "camper" and "instructor" ("instructor in staff shirt"). Apparent gender is fine and useful ("two girls", "a boy and a girl", "a female instructor"); use "camper" when it isn't clear.
- Name specific technology (e.g. "VEX robot", "LEGO Spike", "Minecraft on laptop", "3D printer", "VR headset") only when it is clearly visible; never guess brands or software you can't see.
- Keywords must be things actually supported by the image (no speculative terms like "parents" or "coding" unless visible). Include synonyms (robot / robotics), actions, objects, and setting.
- photo_quality: "poor" if blurry, very dark, or subject cut off.`;

async function tag() {
  const photos = loadSample();
  const done = new Set(readJsonl(F.meta).map((r) => r.id));
  const todo = photos.filter((p) => !done.has(p.id));
  console.log(`${done.size} already tagged, ${todo.length} to go (model ${MODEL}, thinking ${THINKING})`);
  let n = 0, tokens = { in: 0, out: 0, think: 0 }, ms = 0, failed = 0;
  await pool(todo, 8, async (p) => {
    try {
      const url = sizeUrl(p.image_url, "M");
      const img = await withRetry(async () => {
        const r = await fetch(url); if (!r.ok) throw Object.assign(new Error(`image ${r.status}`), { status: r.status });
        return Buffer.from(await r.arrayBuffer());
      }, "image");
      const t0 = Date.now();
      const res = await withRetry(() => ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } }, { text: promptFor(p) }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, thinkingConfig: { thinkingLevel: THINKING } },
      }), p.id);
      const dt = Date.now() - t0;
      const u = res.usageMetadata ?? {};
      tokens.in += u.promptTokenCount ?? 0; tokens.out += u.candidatesTokenCount ?? 0; tokens.think += u.thoughtsTokenCount ?? 0; ms += dt;
      const meta = JSON.parse(res.text);
      fs.appendFileSync(F.meta, JSON.stringify({ id: p.id, model: res.modelVersion ?? MODEL, prompt_ver: PROMPT_VER, ms: dt, usage: u, ...meta }) + "\n");
      if (++n % 20 === 0) console.log(`  ${n}/${todo.length}`);
    } catch (e) {
      failed++; console.warn(`  FAILED ${p.id}: ${e.message?.slice(0, 200)}`);
    }
  });
  if (n) console.log(`tagged ${n}, failed ${failed}. avg ${Math.round(ms / n)} ms; avg tokens/photo in ${Math.round(tokens.in / n)}, out ${Math.round(tokens.out / n)}, thinking ${Math.round(tokens.think / n)}`);
}

// ---------- embed ----------

const docText = (m, p) => [
  m.caption,
  `People: ${m.people_count_bucket}. Shot: ${m.shot_type}.`,
  m.apparent_genders ? `Apparent genders: ${Object.entries(m.apparent_genders).filter(([, n]) => n > 0).map(([g, n]) => `${n} ${g}`).join(", ") || "none"}.` : "",
  `Activities: ${m.activities.join(", ")}.`,
  `Technology: ${m.technology.join(", ")}.`,
  `Objects: ${m.objects.join(", ")}.`,
  `Setting: ${m.setting.join(", ")}. Mood: ${m.mood.join(", ")}.`,
  `Keywords: ${m.keywords.join(", ")}.`,
  `${p.division} — ${p.location}, ${p.week}.`,
].join("\n");

// Each text must be its own Content object. A bare string[] is merged into ONE
// Content (one part per string) and comes back as a single vector.
async function embedText(texts, taskType) {
  const contents = [].concat(texts).map((text) => ({ role: "user", parts: [{ text }] }));
  const res = await withRetry(() => ai.models.embedContent({
    model: EMBED_MODEL, contents, config: { taskType, outputDimensionality: DIMS },
  }), "embed");
  return res.embeddings.map((e) => e.values);
}

async function embed() {
  const photos = new Map(loadSample().map((p) => [p.id, p]));
  const metas = readJsonl(F.meta);
  const store = fs.existsSync(F.emb) ? JSON.parse(fs.readFileSync(F.emb, "utf8")) : { text: {}, image: {} };

  // One call per document: gemini-embedding-2 folds a multi-item `contents`
  // array into a single embedding rather than returning one per item.
  const needText = metas.filter((m) => !store.text[m.id]);
  await pool(needText, 8, async (m) => {
    const [vec] = await embedText(docText(m, photos.get(m.id)), "RETRIEVAL_DOCUMENT");
    store.text[m.id] = vec;
  });
  console.log(`text embeddings: ${Object.values(store.text).filter(Boolean).length}`);

  // Image embeddings: embed the picture itself, for comparison with metadata search.
  const needImg = metas.filter((m) => store.image[m.id] === undefined);
  let imgErr = null;
  await pool(needImg, 6, async (m) => {
    if (imgErr) return;
    try {
      const r = await fetch(sizeUrl(photos.get(m.id).image_url, "M"));
      const data = Buffer.from(await r.arrayBuffer()).toString("base64");
      const res = await withRetry(() => ai.models.embedContent({
        model: EMBED_MODEL, contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data } }] }],
        config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: DIMS },
      }), "img-embed");
      store.image[m.id] = res.embeddings[0].values;
    } catch (e) { imgErr = e; }
  });
  if (imgErr) console.warn(`image embeddings unavailable: ${String(imgErr.message ?? imgErr).slice(0, 200)}`);
  console.log(`image embeddings: ${Object.values(store.image).filter(Boolean).length}`);
  fs.writeFileSync(F.emb, JSON.stringify(store));
}

// ---------- search ----------

const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); };
const tokenize = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const STOP = new Set("a an the of on in at to and or with for is are two one three some kids kid campers camper people photo shot".split(" "));

function keywordScores(query, metas, photos) {
  // Simple BM25 over the metadata document.
  const docs = metas.map((m) => tokenize(docText(m, photos.get(m.id))));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = tokenize(query).filter((t) => !STOP.has(t));
  return docs.map((d) => {
    let s = 0;
    for (const t of q) {
      const tf = d.filter((x) => x === t || (t.length > 4 && x.startsWith(t.slice(0, -1)))).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.length / avg));
    }
    return s;
  });
}

const rrf = (lists, k = 60) => {
  const s = new Map();
  for (const list of lists) list.forEach((id, rank) => s.set(id, (s.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};

async function runQuery(query, top = 8) {
  const photos = new Map(loadSample().map((p) => [p.id, p]));
  const metas = readJsonl(F.meta);
  const store = JSON.parse(fs.readFileSync(F.emb, "utf8"));
  const [qv] = await embedText(query, "RETRIEVAL_QUERY");

  const vecRank = metas.map((m) => [m.id, cos(qv, store.text[m.id])]).sort((a, b) => b[1] - a[1]);
  const kw = keywordScores(query, metas, photos);
  const kwRank = metas.map((m, i) => [m.id, kw[i]]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const hybrid = rrf([vecRank.map(([id]) => id), kwRank.map(([id]) => id)]);
  const imgRank = Object.keys(store.image).length
    ? metas.filter((m) => store.image[m.id]).map((m) => [m.id, cos(qv, store.image[m.id])]).sort((a, b) => b[1] - a[1])
    : [];

  const vecScore = new Map(vecRank);
  const pack = (ids) => ids.slice(0, top).map((id) => ({ ...photos.get(id), meta: metas.find((m) => m.id === id), sim: vecScore.get(id) }));
  return { query, hybrid: pack(hybrid), image: pack(imgRank.map(([id]) => id)) };
}

async function search(query) {
  const r = await runQuery(query);
  console.log(`\n"${query}" — hybrid (metadata embeddings + keywords):`);
  r.hybrid.forEach((p, i) => console.log(`${i + 1}. [${p.sim.toFixed(3)}] ${p.meta.caption}\n   ${sizeUrl(p.image_url, "L")}`));
  if (r.image.length) {
    console.log(`\nimage-embedding only:`);
    r.image.forEach((p, i) => console.log(`${i + 1}. ${p.meta.caption.slice(0, 110)}…`));
  }
}

// ---------- report ----------

const QUERIES = [
  "two kids working on a robotics project together",
  "instructor helping a camper at a laptop",
  "campers playing Minecraft",
  "group photo of everyone outside",
  "close-up of hands building with LEGO",
  "kids wearing VR headsets",
  "3D printer printing a part",
  "campers presenting their project to the group",
  "kids having fun outdoors during a break",
  "camper smiling at the camera holding their creation",
  "a classroom full of students coding",
  "drone or flying robot",
  "camp check-in or welcome table",
  "game design on screen",
  "girls working on robotics",
  "female instructor teaching a class",
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function report() {
  const results = [];
  for (const q of QUERIES) { results.push(await runQuery(q)); process.stdout.write("."); }
  const card = (p, i) => `<a class="card" href="${esc(sizeUrl(p.image_url, "XL"))}" target="_blank" title="${esc(p.meta.caption)}">
    <img loading="lazy" src="${esc(sizeUrl(p.image_url, "S"))}"><span class="n">${i + 1}</span>
    <div class="cap">${esc(p.meta.caption)}</div><div class="loc">${esc(p.location)} · ${esc(p.starts_on)}</div></a>`;
  const metas = readJsonl(F.meta);
  const avg = (f) => Math.round(metas.reduce((s, m) => s + (f(m) ?? 0), 0) / metas.length);
  const html = `<!doctype html><meta charset="utf-8"><title>AI Search Prototype</title>
<style>body{font:14px system-ui;margin:24px;background:#f6f6f4;color:#222}h2{margin:32px 0 6px}h3{font-size:13px;color:#666;margin:10px 0 6px;font-weight:600}
.row{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.card{background:#fff;border-radius:8px;overflow:hidden;text-decoration:none;color:inherit;position:relative;box-shadow:0 1px 2px #0002}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}.n{position:absolute;top:6px;left:6px;background:#000a;color:#fff;border-radius:10px;padding:1px 7px;font-size:12px}
.cap{font-size:11.5px;padding:6px 8px 2px;line-height:1.35;max-height:6.8em;overflow:hidden}.loc{font-size:11px;color:#888;padding:2px 8px 8px}.sum{color:#555}</style>
<h1>AI search prototype</h1>
<p class="sum">${metas.length} photos · model ${esc(metas[0]?.model)} · thinking ${esc(THINKING)} · avg ${avg((m) => m.ms)} ms/photo · avg tokens in ${avg((m) => m.usage?.promptTokenCount)}, out ${avg((m) => m.usage?.candidatesTokenCount)}, thinking ${avg((m) => m.usage?.thoughtsTokenCount)}.
Note: with only ${metas.length} photos, some queries may have no true match — check whether the top results are the <i>best available</i>.</p>
${results.map((r) => `<h2>${esc(r.query)}</h2><h3>Hybrid: metadata embedding + keywords</h3><div class="row">${r.hybrid.map(card).join("")}</div>
${r.image.length ? `<h3>Image embedding only</h3><div class="row">${r.image.map(card).join("")}</div>` : ""}`).join("\n")}`;
  fs.writeFileSync(F.report, html);
  console.log(`\nwrote ${path.resolve(F.report)}`);
}

// ---------- main ----------

const [cmd, arg] = process.argv.slice(2);
const cmds = { sample: () => sample(Number(arg) || 200), tag, embed, search: () => search(arg), report };
if (!cmds[cmd]) { console.error("usage: sample [n] | tag | embed | search \"query\" | report"); process.exit(1); }
await cmds[cmd]();
