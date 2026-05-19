import { defineConfig } from "vitest/config";
import path from "node:path";

// Pure unit tests — no Supabase, no fixtures. Lives alongside the API
// integration config (`vitest.config.ts`) so the two suites stay isolated:
// API tests gate hard on a local Supabase URL via tests/setup.ts; unit
// tests have no such requirement and shouldn't pay for it.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
