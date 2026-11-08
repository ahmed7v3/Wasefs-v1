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
 *
 * `display: optional` (2026-11-08): with `swap` the hero text painted in the fallback and was painted
 * again when the font arrived, and Lighthouse counted that second paint as the LCP (~3 s on mobile).
 * Optional uses the preloaded font when it is there within the short block period, else keeps the
 * metric-adjusted fallback for that visit (no swap, no layout shift); the next visit has it cached.
 */

/** Body text (400) and headings (700). */
export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  display: "optional",
  variable: "--font-plex-arabic",
});

/** Medium and semibold text; fetched lazily (see above). */
export const plexArabicStrong = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["500", "600"],
  display: "optional",
  preload: false,
  variable: "--font-plex-arabic-strong",
});
