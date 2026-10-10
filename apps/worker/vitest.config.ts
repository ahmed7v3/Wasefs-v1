import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Containers take a while to pull and start on a cold machine.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
