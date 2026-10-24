import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ogImageSchema, type OgImage, type OgLocale } from "@wasfa/shared/schemas/og";
import sharp from "sharp";

import { fitText, type Fitted } from "./fit.js";
import { measureText, OG_FONT_FAMILY, type OgFontWeight } from "./fonts.js";

/** Bump when the shared frame (background, header, footer, spacing) changes: every card is re-rendered. */
export const FRAME_VERSION = 1;

export const WIDTH = 1200;
export const HEIGHT = 630;
/** X crops the card to 2:1; everything that matters stays inside 1100x550 (BRAND §2.1). */
export const SAFE = { left: 50, right: 1150, top: 40, bottom: 590 } as const;
export const SAFE_WIDTH = SAFE.right - SAFE.left;
/** Free area between the header and the footer. */
export const CONTENT = { top: 140, bottom: 560 } as const;

/** Brand tokens (`packages/ui/tokens.css`); the worker cannot import CSS, so they are repeated here. */
export const COLOR = {
  primary: "#1e3a8a",
  accent: "#60a5fa",
  accentSoft: "#e6f1fe",
  bgWarm: "#f6f6f4",
  text: "#0b1220",
  textMuted: "#4a5670",
} as const;

export const MIN_TEXT_SIZE = 28;
export const TITLE_SIZES = [56, 52, 48, 44, 40] as const;

export interface Side {
  locale: OgLocale;
  /** Arabic cards are right-aligned, English cards left-aligned. */
  rtl: boolean;
  /** x of the edge text starts from (the safe area's right edge for Arabic, left for English). */
  edge: number;
}

export function sideOf(locale: OgLocale): Side {
  return locale === "ar"
    ? { locale, rtl: true, edge: SAFE.right }
    : { locale, rtl: false, edge: SAFE.left };
}

export const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const hasArabic = (text: string): boolean => /[؀-ۿ]/.test(text);

interface TextOptions {
  size: number;
  weight?: OgFontWeight;
  fill?: string;
  /** Text direction; defaults to the card's. */
  rtl?: boolean;
  /** Align to the card's end side (Arabic: right) instead of its start side. */
  alignRight?: boolean;
  x: number;
  y: number;
}

/**
 * One SVG `<text>`. librsvg follows SVG 1.1 literally: `text-anchor` is relative to `direction`,
 * so right-aligned Arabic is `direction="rtl"` + `text-anchor="start"` at the right edge (spike
 * result, see README). The four direction x alignment combinations are resolved here once.
 */
export function textEl(text: string, side: Side, options: TextOptions): string {
  const rtl = options.rtl ?? side.rtl;
  const alignRight = options.alignRight ?? side.rtl;
  const anchor = alignRight === rtl ? "start" : "end";
  return `<text x="${String(options.x)}" y="${String(options.y)}" font-family="${OG_FONT_FAMILY}" font-weight="${String(options.weight ?? 400)}" font-size="${String(options.size)}" fill="${options.fill ?? COLOR.text}" direction="${rtl ? "rtl" : "ltr"}" text-anchor="${anchor}">${escapeXml(text)}</text>`;
}

/** A block of lines: `height` to stack it, `at(y)` to draw it with its top at `y`. */
export interface Block {
  height: number;
  at: (y: number) => string;
}

export interface ColumnOptions {
  /** x of the column's start edge and its width (defaults: the full safe area). */
  edge?: number;
  width?: number;
}

export async function textBlock(
  text: string,
  side: Side,
  options: ColumnOptions & {
    sizes: readonly number[];
    maxLines: number;
    weight: OgFontWeight;
    fill: string;
    /** Per-text direction (a Latin name on an Arabic card); defaults to the card's. */
    rtl?: boolean;
  },
): Promise<Block & { fitted: Fitted }> {
  const rtl = options.rtl ?? side.rtl;
  const fitted = await fitText(text, {
    maxWidth: options.width ?? SAFE_WIDTH,
    sizes: options.sizes,
    maxLines: options.maxLines,
    weight: options.weight,
  });
  const x = options.edge ?? side.edge;
  return {
    fitted,
    height: fitted.lines.length * fitted.lineHeight,
    at: (y) =>
      fitted.lines
        .map((line, index) =>
          textEl(line, side, {
            x,
            // Baseline sits about 1.05 em below the line box top for Plex Arabic (tall marks above).
            y: y + Math.round(fitted.size * 1.05) + index * fitted.lineHeight,
            size: fitted.size,
            weight: options.weight,
            fill: options.fill,
            rtl,
          }),
        )
        .join(""),
  };
}

/** Rounded label (category, "Guide"): accent-soft fill, navy bold text, 28 px. */
export async function chipBlock(
  label: string,
  side: Side,
  options: ColumnOptions = {},
): Promise<Block> {
  const edge = options.edge ?? side.edge;
  const textWidth = await measureText(label, MIN_TEXT_SIZE, 700);
  const padding = 22;
  const width = textWidth + padding * 2;
  const height = 52;
  return {
    height,
    at: (y) => {
      const x = side.rtl ? edge - width : edge;
      return (
        `<rect x="${String(x)}" y="${String(y)}" width="${String(width)}" height="${String(height)}" rx="26" fill="${COLOR.accentSoft}" stroke="${COLOR.accent}" stroke-width="2"/>` +
        textEl(label, side, {
          x: side.rtl ? edge - padding : edge + padding,
          y: y + 37,
          size: MIN_TEXT_SIZE,
          weight: 700,
          fill: COLOR.primary,
        })
      );
    },
  };
}

export function gap(height: number): Block {
  return { height, at: () => "" };
}

/** Stacks blocks top to bottom and centres the stack vertically in `area`. */
export function stack(
  blocks: readonly Block[],
  area: { top: number; bottom: number } = CONTENT,
): string {
  const total = blocks.reduce((sum, block) => sum + block.height, 0);
  let y = area.top + Math.max(0, Math.round((area.bottom - area.top - total) / 2));
  let svg = "";
  for (const block of blocks) {
    svg += block.at(y);
    y += block.height;
  }
  return svg;
}

const SYMBOL_PATHS = [
  fileURLToPath(new URL("./assets/symbol.svg", import.meta.url)),
  // Compiled output (`dist/og`) has no copy of the SVG; the repository layout (and the image) keep `src/og/assets`.
  fileURLToPath(new URL("../../src/og/assets/symbol.svg", import.meta.url)),
];

let symbolSource: string | undefined;

/** The brand symbol file, replaceable without touching the templates. Its content is part of the card hash. */
export function readSymbol(): string {
  if (symbolSource !== undefined) return symbolSource;
  for (const path of SYMBOL_PATHS) {
    try {
      symbolSource = readFileSync(path, "utf8");
      return symbolSource;
    } catch {
      // try the next location
    }
  }
  throw new Error("OG symbol asset not found (src/og/assets/symbol.svg)");
}

/** The symbol as a nested `<svg>` of `size` px at (`x`, `y`); its own width/height/x/y are replaced. */
function symbolAt(x: number, y: number, size: number): string {
  return readSymbol()
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(
      /<svg\b([^>]*)>/,
      (_match, attributes: string) =>
        `<svg${attributes.replace(/\s(?:x|y|width|height)="[^"]*"/g, "")} x="${String(x)}" y="${String(y)}" width="${String(size)}" height="${String(size)}">`,
    )
    .trim();
}

const WORDMARK = { ar: "وصفة AI", en: "Wasfa AI" } as const;

/** The common frame of every template; `body` is drawn between the header and the footer. */
export function frame(side: Side, body: string): string {
  const symbolSize = 64;
  const symbolX = side.rtl ? SAFE.right - symbolSize : SAFE.left;
  const wordmarkX = side.rtl ? symbolX - 18 : symbolX + symbolSize + 18;
  const urlText = textEl("wasfa.online", side, {
    x: side.rtl ? SAFE.left : SAFE.right,
    y: SAFE.bottom - 12,
    size: MIN_TEXT_SIZE,
    weight: 400,
    fill: COLOR.textMuted,
    rtl: false,
    // Opposite corner from the header: left for Arabic cards, right for English ones.
    alignRight: !side.rtl,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(HEIGHT)}" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}">
<defs>
<pattern id="lattice" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H56M0 0V56" fill="none" stroke="${COLOR.primary}" stroke-opacity="0.045" stroke-width="2"/></pattern>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${COLOR.accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${COLOR.accent}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${String(WIDTH)}" height="${String(HEIGHT)}" fill="${COLOR.bgWarm}"/>
<rect width="${String(WIDTH)}" height="${String(HEIGHT)}" fill="url(#lattice)"/>
<circle cx="${side.rtl ? "70" : "1130"}" cy="560" r="300" fill="url(#glow)"/>
<rect width="${String(WIDTH)}" height="6" fill="${COLOR.primary}"/>
${symbolAt(symbolX, SAFE.top, symbolSize)}
${textEl(WORDMARK[side.locale], side, { x: wordmarkX, y: SAFE.top + 44, size: 32, weight: 700, fill: COLOR.primary })}
${body}
${urlText}
</svg>`;
}

/**
 * A library image cropped to `width` x `height` around its focal point and embedded in the SVG
 * (rounded corners, or a circle when `circle`). `x`/`y` is its top-left corner.
 */
export async function imagePanel(
  source: Buffer,
  focal: Pick<OgImage, "focalX" | "focalY">,
  box: { x: number; y: number; width: number; height: number; circle?: boolean; id: string },
): Promise<string> {
  const focalChecked = ogImageSchema.pick({ focalX: true, focalY: true }).parse(focal);
  // Apply the EXIF orientation first so the focal point and crop work on what a viewer sees.
  const oriented = await sharp(source, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const { width: sourceWidth, height: sourceHeight } = oriented.info;
  const scale = Math.max(box.width / sourceWidth, box.height / sourceHeight);
  const cropWidth = Math.min(sourceWidth, Math.round(box.width / scale));
  const cropHeight = Math.min(sourceHeight, Math.round(box.height / scale));
  const left = Math.min(
    sourceWidth - cropWidth,
    Math.max(0, Math.round((sourceWidth * focalChecked.focalX) / 100 - cropWidth / 2)),
  );
  const top = Math.min(
    sourceHeight - cropHeight,
    Math.max(0, Math.round((sourceHeight * focalChecked.focalY) / 100 - cropHeight / 2)),
  );
  const jpeg = await sharp(oriented.data)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(box.width, box.height)
    .jpeg({ quality: 82 })
    .toBuffer();
  const clip =
    box.circle === true
      ? `<circle cx="${String(box.x + box.width / 2)}" cy="${String(box.y + box.height / 2)}" r="${String(box.width / 2)}"/>`
      : `<rect x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" rx="24"/>`;
  return `<clipPath id="${box.id}">${clip}</clipPath><image x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" clip-path="url(#${box.id})" href="data:image/jpeg;base64,${jpeg.toString("base64")}"/>${
    box.circle === true
      ? `<circle cx="${String(box.x + box.width / 2)}" cy="${String(box.y + box.height / 2)}" r="${String(box.width / 2)}" fill="none" stroke="${COLOR.primary}" stroke-width="6"/>`
      : `<rect x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" rx="24" fill="none" stroke="${COLOR.primary}" stroke-width="3"/>`
  }`;
}

/** Template labels per locale (the worker has no i18n runtime; copy lives next to the templates). */
export const LABELS = {
  ar: {
    guide: "دليل",
    glossary: "مصطلح",
    by: "بقلم",
    activeIngredient: "المادة الفعالة",
    sections: (count: number): string =>
      count === 1
        ? "قسم واحد"
        : count === 2
          ? "قسمان"
          : count <= 10
            ? `${String(count)} أقسام`
            : `${String(count)} قسمًا`,
  },
  en: {
    guide: "Guide",
    glossary: "Glossary",
    by: "By",
    activeIngredient: "Active ingredient",
    sections: (count: number): string => (count === 1 ? "1 section" : `${String(count)} sections`),
  },
} as const;
