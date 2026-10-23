import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The end-to-end suite builds the app twice with different NEXT_PUBLIC_* values (one with
  // Turnstile, one without) and keeps both builds side by side. Unset = the default `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Small self-contained server for the Docker image (`.next/standalone`).
  output: "standalone",
  // Trace files from the monorepo root so workspace packages end up in the standalone output.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  // @wasfa/ui ships TypeScript source.
  transpilePackages: ["@wasfa/ui"],
  // `experimental.inlineCss` measured 2026-10-23 (Lighthouse mobile, median of 3, production build):
  // LCP +150 ms on `/` and +146 ms on `/pricing`, +48 KB of uncacheable HTML per page. Rejected.
};

export default nextConfig;
