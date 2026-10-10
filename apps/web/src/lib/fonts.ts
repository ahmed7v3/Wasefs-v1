import { Alexandria, IBM_Plex_Sans_Arabic } from "next/font/google";

/*
 * Fonts are downloaded at build time and served from our own origin: no runtime request to Google.
 *
 * Only what the first paint needs is preloaded. `next/font` preloads every weight x subset it is
 * given, so Plex Sans Arabic is declared twice under the same family name: 400 (body text, preloaded)
 * and 500/600 (loaded on demand, only when a page really uses them). The browser merges the
 * @font-face rules, so `font-medium` / `font-semibold` still resolve to the right file. Preloading
 * all three weights adds ~110 KB to every page and costs ~10 Lighthouse performance points.
 */

/** Headings. One variable file per subset covers weights 500-700. */
export const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-alexandria",
});

/** Body text. */
export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-plex-arabic",
});

/** Medium and semibold body text; fetched lazily (see above). */
export const plexArabicStrong = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["500", "600"],
  display: "swap",
  preload: false,
  variable: "--font-plex-arabic-strong",
});
