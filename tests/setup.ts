import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.test.local") });
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `API tests require local Supabase. Missing env vars: ${missing.join(", ")}. ` +
      `Run \`npx supabase start\`, then put the local URL + keys in \`.env.test.local\` ` +
      `(preferred) or \`.env.local\`.`,
  );
}

// Hard guard: refuse to run the suite against a non-local Supabase. The
// fixtures create + delete auth users, divisions, locations, etc — any of
// those against production is destructive.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const looksLocal =
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|kong)(:\d+)?(\/|$)/.test(
    supabaseUrl,
  );
if (!looksLocal) {
  throw new Error(
    `Refusing to run API tests against non-local Supabase URL (${supabaseUrl}). ` +
      `Tests create and delete fixture data; only point them at a local stack. ` +
      `Set NEXT_PUBLIC_SUPABASE_URL to a localhost / 127.0.0.1 URL in \`.env.test.local\` ` +
      `or override the URL in your shell before running \`npm run test:api\`.`,
  );
}

if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = "test-cron-secret";
}

// Stub `server-only` so route-handler imports don't blow up under Vitest.
// Next.js injects a no-op for this in its bundler; under Vitest the bare
// package throws.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
