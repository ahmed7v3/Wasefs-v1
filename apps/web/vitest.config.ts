import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Component tests opt into jsdom per file with `// @vitest-environment jsdom`.
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
