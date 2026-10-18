import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every integration file starts its own Postgres container; when they start side by side on a
    // cold machine, booting and migrating takes well over vitest's 10-second default (same budget
    // as the api's config).
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
