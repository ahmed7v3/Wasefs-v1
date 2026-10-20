import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    // Same as apps/web: `turbo run test` runs every package at once on CI, and jsdom keyboard
    // tests starved of CPU there (beside the worker's image encoding) overran the 5 s default.
    testTimeout: 20_000,
  },
});
