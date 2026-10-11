/* global document -- used only inside page.evaluate(), which runs in the browser */
/*
 * Renders the Open Graph images (1200x630 PNG, one per public page) and the square logo that the
 * Organization JSON-LD points to, with Playwright's Chromium. The output is committed under
 * apps/web/public; run this only when a title or the brand changes:
 *
 *   pnpm --filter @wasfa/web og:images
 *
 * Needs a Chromium for Playwright (`pnpm exec playwright install chromium` once) and network access
 * for the Alexandria webfont (Google Fonts), because the Arabic headline must be set in the brand
 * heading face. Chromium shapes the Arabic text itself, so letters join correctly.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const BRAND = "وصفة AI";
const TAGLINE = "مساعدك الطبي الذكي لتحليل الروشتات";

/** One image per page: file name (under public/og) and the headline. Keep in step with content/. */
const PAGES = [
  { file: "home", title: "افهم روشتتك في ثوانٍ", subtitle: TAGLINE },
  { file: "privacy", title: "سياسة الخصوصية", subtitle: BRAND },
  { file: "terms", title: "شروط الاستخدام", subtitle: BRAND },
  { file: "disclaimer", title: "إخلاء المسؤولية الطبية", subtitle: BRAND },
  { file: "contact", title: "اتصل بنا", subtitle: BRAND },
];

// lucide "pill", the same mark as the site header (apps/web/src/components/brand-mark.tsx).
const PILL =
  '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>';

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alexandria:wght@500;700&display=block">';

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body { font-family: "Alexandria", "Segoe UI", Tahoma, sans-serif; }
`;

function ogHtml({ title, subtitle }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
${FONT_LINK}
<style>
${BASE_CSS}
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative; color: #ffffff;
    background:
      radial-gradient(640px 420px at 12% 108%, rgba(96,165,250,0.55), transparent 70%),
      radial-gradient(520px 380px at 96% -10%, rgba(96,165,250,0.35), transparent 70%),
      linear-gradient(135deg, #1e3a8a 0%, #172e6e 100%);
  }
  .ring { position: absolute; border-radius: 50%; border: 2px solid rgba(255,255,255,0.12); }
  .ring.a { width: 520px; height: 520px; inset-inline-start: -160px; inset-block-start: -200px; }
  .ring.b { width: 360px; height: 360px; inset-inline-start: -80px; inset-block-start: -120px; }
  .frame { position: absolute; inset: 0; padding: 72px 88px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 20px; }
  .mark { width: 76px; height: 76px; border-radius: 20px; background: #ffffff; display: grid; place-items: center; }
  .mark svg { width: 44px; height: 44px; stroke: #1e3a8a; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .brand-name { font-size: 44px; font-weight: 700; }
  h1 { font-size: 96px; font-weight: 700; line-height: 1.4; max-width: 1000px; text-wrap: balance; }
  .subtitle { margin-top: 44px; font-size: 40px; font-weight: 500; color: #cfe0fb; }
  .url { font-size: 32px; font-weight: 500; color: #cfe0fb; direction: ltr; text-align: start; }
</style>
</head>
<body>
  <div class="ring a"></div><div class="ring b"></div>
  <div class="frame">
    <div class="brand">
      <div class="mark"><svg viewBox="0 0 24 24" aria-hidden="true">${PILL}</svg></div>
      <div class="brand-name">${BRAND}</div>
    </div>
    <div>
      <h1>${title}</h1>
      <p class="subtitle">${subtitle}</p>
    </div>
    <div class="url">wasfa.online</div>
  </div>
</body>
</html>`;
}

function logoHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>
${BASE_CSS}
  html, body { background: transparent; }
  .mark { width: 512px; height: 512px; border-radius: 128px; background: #1e3a8a; display: grid; place-items: center; }
  .mark svg { width: 300px; height: 300px; stroke: #ffffff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
</head>
<body><div class="mark"><svg viewBox="0 0 24 24" aria-hidden="true">${PILL}</svg></div></body>
</html>`;
}

async function renderFonts(page) {
  // `display=block` waits for the face; this makes sure both weights are really loaded before the shot.
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('700 96px "Alexandria"', "افهم"),
      document.fonts.load('500 40px "Alexandria"', "مساعدك"),
    ]);
    await document.fonts.ready;
  });
}

const browser = await chromium.launch();
try {
  await mkdir(`${PUBLIC_DIR}og`, { recursive: true });

  const og = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const entry of PAGES) {
    await og.setContent(ogHtml(entry), { waitUntil: "networkidle" });
    await renderFonts(og);
    await og.screenshot({ path: `${PUBLIC_DIR}og/${entry.file}.png`, type: "png" });
  }

  const logo = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  await logo.setContent(logoHtml(), { waitUntil: "load" });
  await logo.screenshot({ path: `${PUBLIC_DIR}logo.png`, type: "png", omitBackground: true });
} finally {
  await browser.close();
}
