import type { SiteFont } from "@wasfa/shared/settings";

/*
 * The site font is admin-switchable (`branding.font`). Both families are self-hosted woff2 files under
 * `public/fonts/v1` and declared in `app/fonts.css`; `<html data-font>` picks which one `--font-sans` points
 * at. Only the active family's first-paint files are preloaded, so switching adds no bytes to any page.
 * The files are cached as immutable (next.config.ts): change a file => bump `FONT_BASE`'s version segment
 * here, in `fonts.css` and in the folder name.
 *
 * `display: optional` (2026-11-08, in fonts.css): with `swap` the hero text painted in the fallback and was
 * painted again when the font arrived, and Lighthouse counted that second paint as the LCP (~3 s on mobile).
 * Optional uses the preloaded font when it is there within the short block period, else keeps the
 * metric-adjusted fallback for that visit (no swap, no layout shift); the next visit has it cached.
 *
 * Plex: only 400 (the hero text) is preloaded; 700 and the rest load on demand and, being `optional`, may
 * miss the first visit rather than delay the paint.
 * Alan Sans is one variable file per subset (300-900); latin-ext loads on demand.
 */

export const FONT_BASE = "/fonts/v1";

/** The files to preload for the first paint, per family. */
const PRELOAD_FILES: Record<SiteFont, readonly string[]> = {
  plex: [
    "plex-arabic-arabic-400.woff2",
    "plex-arabic-latin-400.woff2",
    "plex-arabic-arabic-700.woff2",
    "plex-arabic-latin-700.woff2",
  ],
  alan: ["alan-sans-arabic.woff2", "alan-sans-latin.woff2"],
};

/** Public URLs of the font files to preload for the chosen family. */
export function fontPreloadUrls(font: SiteFont): string[] {
  return PRELOAD_FILES[font].map((file) => `${FONT_BASE}/${file}`);
}
