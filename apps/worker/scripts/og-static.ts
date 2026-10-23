/*
 * Regenerates the static Open Graph images of the public pages (apps/web/public/og/*.png, 1200x630)
 * through the worker's `page` template, so they match the generated cards of the content platform:
 *
 *   pnpm --filter @wasfa/worker og:static
 *
 * Same file names and size as the Playwright script it replaces (apps/web/scripts/og-images.mjs).
 * Keep the titles in step with the page content under apps/web/src/content.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderOgCard } from "../src/og/render.js";
import { pageTemplate } from "../src/og/templates/index.js";

const OUTPUT_DIR = fileURLToPath(new URL("../../web/public/og/", import.meta.url));

const BRAND = "وصفة AI";
const TAGLINE = "مساعدك الطبي الذكي لتحليل الروشتات";

const PAGES = [
  { file: "home", title: "افهم روشتتك في ثوانٍ", subtitle: TAGLINE },
  { file: "pricing", title: "الأسعار والباقات", subtitle: BRAND },
  { file: "privacy", title: "سياسة الخصوصية", subtitle: BRAND },
  { file: "terms", title: "شروط الاستخدام", subtitle: BRAND },
  { file: "disclaimer", title: "إخلاء المسؤولية الطبية", subtitle: BRAND },
  { file: "contact", title: "اتصل بنا", subtitle: BRAND },
] as const;

await mkdir(OUTPUT_DIR, { recursive: true });
for (const page of PAGES) {
  const { png } = await renderOgCard(pageTemplate, {
    locale: "ar",
    title: page.title,
    subtitle: page.subtitle,
  });
  await writeFile(`${OUTPUT_DIR}${page.file}.png`, png);
  process.stdout.write(`${page.file}.png ${String(png.byteLength)} bytes\n`);
}
