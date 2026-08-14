import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Every file in this suite shares one local Supabase, and the fixtures
    // contend on the same rows, so the files must not run concurrently.
    // Vitest 4 removed `test.poolOptions` and promoted its contents to
    // top-level options — the old `poolOptions: { forks: { singleFork: true } }`
    // was being silently ignored, which let the files race and produced
    // intermittent failures that moved between files run to run.
    pool: "forks",
    singleFork: true,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
