import { IBM_Plex_Sans_Arabic } from "next/font/google";

/*
 * IBM Plex Sans Arabic is the only typeface of the product (owner decision 2026-10-11). It is
 * downloaded at build time and served from our own origin: no runtime request to Google.
 *
 * Only what the first paint needs is preloaded. `next/font` preloads every weight x subset it is
 * given, so the family is declared twice under the same name: 400 (body) and 700 (headings), both
 * preloaded, and 500/600 (loaded on demand, only when a page really uses them). The browser merges
 * the @font-face rules, so `font-medium` / `font-semibold` still resolve to the right file.
 * Preloading all four weights would add ~110 KB to every page and cost Lighthouse performance points.
 */

/** Body text (400) and headings (700). */
export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-plex-arabic",
});

/** Medium and semibold text; fetched lazily (see above). */
export const plexArabicStrong = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["500", "600"],
  display: "swap",
  preload: false,
  variable: "--font-plex-arabic-strong",
});
