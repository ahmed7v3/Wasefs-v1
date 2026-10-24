import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { type OgInput, type OgTemplateId } from "@wasfa/shared/schemas/og";
import sharp from "sharp";

import { ensureFonts, FONT_FILES } from "./fonts.js";
import { FRAME_VERSION, HEIGHT, readSymbol, WIDTH } from "./frame.js";
import {
  articleTemplate,
  authorTemplate,
  drugTemplate,
  glossaryTemplate,
  guideTemplate,
  pageTemplate,
  type OgAssets,
  type OgTemplate,
} from "./templates/index.js";

/** CONTENT-PLATFORM §5.6: a card is at most 300 KB; above it the PNG is palettised. */
export const OG_MAX_BYTES = 300_000;

export interface RenderedOgCard {
  png: Buffer;
  hash: string;
}

/** JSON with object keys sorted at every level, so equal inputs hash equal whatever their key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

let assetVersion: string | undefined;

/** Digest of everything shared that changes pixels without changing a template: the fonts, the symbol and the frame. */
function assetsVersion(): string {
  assetVersion ??= createHash("sha256")
    .update(readFileSync(FONT_FILES[400]))
    .update(readFileSync(FONT_FILES[700]))
    .update(readSymbol())
    .update(`frame:${String(FRAME_VERSION)}`)
    .digest("hex");
  return assetVersion;
}

/**
 * Hash of a card: the template and its version, the canonical input and the font/brand assets.
 * Image bytes are not hashed; the input names them by sha256, which is.
 */
export function ogCardHash(template: { id: string; version: number }, input: unknown): string {
  return createHash("sha256")
    .update(
      `${template.id}\n${String(template.version)}\n${canonicalJson(input)}\n${assetsVersion()}`,
    )
    .digest("hex");
}

/** SVG to PNG with librsvg, palettised only when the truecolour file would break the budget. */
export async function rasterize(svg: string): Promise<Buffer> {
  ensureFonts();
  const base = sharp(Buffer.from(svg), { density: 72 }).removeAlpha();
  const png = await base.clone().png({ compressionLevel: 9 }).toBuffer();
  if (png.byteLength <= OG_MAX_BYTES) return png;
  return base.png({ compressionLevel: 9, palette: true, quality: 85, effort: 10 }).toBuffer();
}

/** Validates `input` with the template's schema, draws it and returns the PNG (1200x630) with its content hash. */
export async function renderOgCard<T extends OgTemplateId>(
  template: OgTemplate<T>,
  input: unknown,
  assets: OgAssets = {},
): Promise<RenderedOgCard> {
  const parsed = template.schema.parse(input) as OgInput<T>;
  const svg = await template.render(parsed, assets);
  const png = await rasterize(svg);
  const { width, height } = await sharp(png).metadata();
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(
      `OG card is ${String(width)}x${String(height)}, expected ${String(WIDTH)}x${String(HEIGHT)}`,
    );
  }
  return { png, hash: ogCardHash(template, parsed) };
}

type Renderer = (input: unknown, assets?: OgAssets) => Promise<RenderedOgCard>;

const bind =
  <T extends OgTemplateId>(template: OgTemplate<T>): Renderer =>
  (input, assets) =>
    renderOgCard(template, input, assets);

/** Every template by id. */
export const OG_TEMPLATES = {
  page: pageTemplate,
  article: articleTemplate,
  guide: guideTemplate,
  glossary: glossaryTemplate,
  drug: drugTemplate,
  author: authorTemplate,
} as const;

/** Every template as a renderer by id, for callers (the job) that only know the id. */
export const OG_RENDERERS: Record<OgTemplateId, Renderer> = {
  page: bind(pageTemplate),
  article: bind(articleTemplate),
  guide: bind(guideTemplate),
  glossary: bind(glossaryTemplate),
  drug: bind(drugTemplate),
  author: bind(authorTemplate),
};
