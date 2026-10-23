import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

export const OG_FONT_FAMILY = "IBM Plex Sans Arabic";
export type OgFontWeight = 400 | 700;

/** `apps/worker/assets/fonts`, the same from `src/og` (dev, tests) and `dist/og` (production image). */
export const FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
export const FONT_FILES = {
  400: join(FONT_DIR, "IBMPlexSansArabic-Regular.ttf"),
  700: join(FONT_DIR, "IBMPlexSansArabic-Bold.ttf"),
} as const;

let configured = false;

/**
 * Points fontconfig (used by librsvg for SVG text and by Pango for `sharp({ text })`) at the bundled
 * font directory only, so renders do not depend on, or vary with, the fonts of the host. Must run
 * before the first text render of the process: fontconfig reads `FONTCONFIG_FILE` once.
 */
export function ensureFonts(): void {
  if (configured) return;
  const directory = join(tmpdir(), "wasfa-og-fonts");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "fonts.conf");
  writeFileSync(
    file,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR}</dir>
  <cachedir>${join(directory, "cache")}</cachedir>
</fontconfig>
`,
  );
  process.env["FONTCONFIG_FILE"] = file;
  configured = true;
}

const widths = new Map<string, number>();

const escapeMarkup = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Width in pixels of `text` on one line at `size` px, measured by Pango with the same font the
 * SVG is drawn with (a text-only image has exactly the advance width of the string). Pango
 * resolves the bidi direction from the text itself, so no direction is passed.
 */
export async function measureText(
  text: string,
  size: number,
  weight: OgFontWeight,
): Promise<number> {
  const key = `${String(weight)}|${String(size)}|${text}`;
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  ensureFonts();
  const { info } = await sharp({
    text: {
      text: escapeMarkup(text),
      font: `${OG_FONT_FAMILY}${weight === 700 ? " Bold" : ""} ${String(size)}`,
      fontfile: FONT_FILES[weight],
      dpi: 72,
    },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  widths.set(key, info.width);
  return info.width;
}
