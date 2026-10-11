import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Component tests opt into jsdom per file with `// @vitest-environment jsdom`.
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    // jsdom component tests are slow to start on CI runners (one timed out at the 5 s default).
    testTimeout: 20_000,
  },
});
