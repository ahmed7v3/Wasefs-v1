#!/usr/bin/env node
/**
 * Phase 4 WP1 §2.3: after `next build`, checks the client JavaScript every public route loads.
 *  - Fails if a chunk contains an app-only library (pdf.js, heic2any, qrcode, chat code).
 *  - Prints first-load JS (gzip) per route. Budgets: `/` and `/en` 150 KB, legal pages 170 KB, `/pricing` and `/contact` 235 KB. Over
 *    budget is a warning (exit 0) unless `--strict`.
 * Next's `polyfillFiles` chunk (~113 KB core-js, `nomodule`) is not in `firstLoadChunkPaths`, so it is
 * not counted: modern browsers never download it.
 * Reads `.next/diagnostics/route-bundle-stats.json` (Next 16 / Turbopack). Run from apps/web.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const strict = process.argv.includes("--strict");
const distDir = resolve(process.env.NEXT_DIST_DIR || ".next");

const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/contact",
  "/privacy",
  "/terms",
  "/disclaimer",
  "/en",
  // Content templates (WP3): server-rendered, their only client code is the marketing chrome.
  "/blog",
  "/blog/[slug]",
  "/guides/[slug]",
  "/glossary/[slug]",
  "/authors/[slug]",
  "/en/blog/[slug]",
];
// Framework floor (React 19 + Next client runtime) is about 120 KB gzip, measured 2026-10-23: 80 KB is not reachable.
// Pages with a real form (zod + the public message catalogue, about 70 KB gzip together) get their own ceiling.
const FORM_ROUTES = new Set(["/pricing", "/contact"]);
const BUDGET_KB = (route) =>
  route === "/" || route === "/en" ? 150 : FORM_ROUTES.has(route) ? 235 : 170;

// Distinctive strings that survive minification (package banners, worker names, API names).
const FORBIDDEN = [
  { name: "pdfjs", needles: ["pdfjs-dist", "pdf.worker", "GlobalWorkerOptions"] },
  { name: "heic2any", needles: ["heic2any", "libheif"] },
  { name: "qrcode", needles: ["QRCode", "qrcode"] },
  // Server-only content code (WP3): the markdown renderer, the revalidation signer, the preview-token signer.
  {
    name: "content-server",
    needles: ["x-revalidate-signature", "rehype-sanitize", "remark-directive", "ReplayCache"],
  },
  { name: "chat", needles: ["chat-composer", "ChatThread", "/ai/chat"] },
];

const stats = JSON.parse(
  readFileSync(resolve(distDir, "diagnostics/route-bundle-stats.json"), "utf8"),
);
const byRoute = new Map(stats.map((entry) => [entry.route, entry]));

const failures = [];
const warnings = [];
const cache = new Map();

function load(chunkPath) {
  // Paths look like ".next/static/chunks/x.js"; resolve against the dist dir to honour NEXT_DIST_DIR.
  const file = resolve(distDir, chunkPath.replace(/^\.next[\\/]/, ""));
  if (!cache.has(file)) {
    const buffer = readFileSync(file);
    cache.set(file, { text: buffer.toString("utf8"), gzip: gzipSync(buffer).length });
  }
  return cache.get(file);
}

for (const route of PUBLIC_ROUTES) {
  const entry = byRoute.get(route);
  if (!entry) {
    // /en does not exist until the locale routes ship.
    warnings.push(`${route}: not in the build (skipped)`);
    continue;
  }
  let gzipBytes = 0;
  for (const chunkPath of entry.firstLoadChunkPaths.filter((path) => path.endsWith(".js"))) {
    const chunk = load(chunkPath);
    gzipBytes += chunk.gzip;
    for (const { name, needles } of FORBIDDEN) {
      const hit = needles.find((needle) => chunk.text.includes(needle));
      if (hit) failures.push(`${route}: ${chunkPath} contains ${name} ("${hit}")`);
    }
  }
  const kb = gzipBytes / 1024;
  const budget = BUDGET_KB(route);
  process.stdout.write(
    `${route.padEnd(12)} ${kb.toFixed(1).padStart(7)} KB gzip (budget ${budget} KB)\n`,
  );
  if (kb > budget) {
    (strict ? failures : warnings).push(
      `${route}: first-load JS ${kb.toFixed(1)} KB gzip > ${budget} KB`,
    );
  }
}

for (const line of warnings) process.stdout.write(`WARN ${line}\n`);
for (const line of failures) process.stdout.write(`FAIL ${line}\n`);
process.exit(failures.length > 0 ? 1 : 0);
