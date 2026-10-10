import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // esbuild does not emit decorator metadata, which Nest DI needs; SWC does.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.test.ts"],
    // Containers take a while to pull and start on a cold machine.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
