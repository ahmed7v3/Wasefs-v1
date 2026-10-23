import {
  BRANDING_ICON_MAX_BYTES,
  BRANDING_ICON_SIZES,
  type BrandingGeneratedKey,
} from "@wasfa/shared/schemas/branding";
import sharp, { type Sharp } from "sharp";

/*
 * Renders the brand icon set from the admin-uploaded `symbol` (BRAND-AND-HOMEPAGE §1.3):
 *   favicon_ico        ICO holding 16, 32 and 48 px PNG images, transparent background
 *   icon_48/96/192/512 transparent PNG of the symbol
 *   icon_maskable_512  opaque `themeColor` square with the symbol inside the 80 % safe zone
 *   apple_touch_icon   180 px, opaque `themeColor` tile behind the symbol, no alpha channel (iOS
 *                      fills transparency with black and applies its own corner mask)
 * Every PNG is quantised to a palette, with fewer colours until it fits `BRANDING_ICON_MAX_BYTES`;
 * an icon that cannot fit even with 16 colours is left out of the result (the caller logs it).
 */

export interface RenderedIcon {
  key: BrandingGeneratedKey;
  contentType: "image/png" | "image/x-icon";
  data: Buffer;
  /** Largest image inside the file. */
  width: number;
  height: number;
}

/** Symbol share of the side of a maskable or Apple tile (the maskable "safe zone"). */
const TILE_SYMBOL_SHARE = 0.8;
const PALETTE_STEPS = [256, 128, 64, 32, 16] as const;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

// Decoded pixels are not worth keeping around between jobs; memory is the scarce resource here.
sharp.cache(false);

/** Symbol input: SVG is rendered at the size asked for (crisp), a raster is only ever scaled. */
const open = (symbol: Buffer) => sharp(symbol, { limitInputPixels: 25_000_000, failOn: "error" });

async function symbolAt(symbol: Buffer, side: number): Promise<Buffer> {
  return open(symbol)
    .resize(side, side, { fit: "contain", background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/** Smallest palette PNG of `pipeline`'s output that fits the budget, or null. */
async function fitPng(make: () => Sharp): Promise<Buffer | null> {
  for (const colours of PALETTE_STEPS) {
    const data = await make()
      .png({ palette: true, colours, compressionLevel: 9, effort: 10 })
      .toBuffer();
    if (data.length <= BRANDING_ICON_MAX_BYTES) return data;
  }
  return null;
}

/** An ICO whose images are PNG files (Vista and later, every current browser). */
export function buildIco(images: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

async function tile(
  symbol: Buffer,
  side: number,
  background: string,
  opaque: boolean,
): Promise<Sharp> {
  const inner = Math.round(side * TILE_SYMBOL_SHARE);
  const base = sharp({ create: { width: side, height: side, channels: 4, background } }).composite([
    { input: await symbolAt(symbol, inner), gravity: "centre" },
  ]);
  return opaque ? base.flatten({ background }).removeAlpha() : base;
}

/**
 * All icons that fit their budget, for `themeColor` (`#rrggbb`). Throws when `symbol` cannot be
 * decoded; that is a data error for the caller to log, not something a retry fixes.
 */
export async function renderIcons(symbol: Buffer, themeColor: string): Promise<RenderedIcon[]> {
  const out: RenderedIcon[] = [];
  const png = async (key: BrandingGeneratedKey, side: number, make: () => Sharp) => {
    const data = await fitPng(make);
    if (data) out.push({ key, contentType: "image/png", data, width: side, height: side });
  };

  const plain = [
    ["icon_48", 48],
    ["icon_96", 96],
    ["icon_192", 192],
    ["icon_512", 512],
  ] as const;
  for (const [key, side] of plain) {
    const base = await symbolAt(symbol, side);
    await png(key, side, () => sharp(base));
  }

  const maskable = await tile(symbol, 512, themeColor, true);
  const maskableBuffer = await maskable.png().toBuffer();
  await png("icon_maskable_512", 512, () => sharp(maskableBuffer));

  const apple = await tile(symbol, BRANDING_ICON_SIZES.apple_touch_icon[0], themeColor, true);
  const appleBuffer = await apple.png().toBuffer();
  await png("apple_touch_icon", BRANDING_ICON_SIZES.apple_touch_icon[0], () => sharp(appleBuffer));

  const frames: { size: number; png: Buffer }[] = [];
  for (const size of BRANDING_ICON_SIZES.favicon_ico) {
    const base = await symbolAt(symbol, size);
    const framed = await fitPng(() => sharp(base));
    if (framed) frames.push({ size, png: framed });
  }
  if (frames.length === BRANDING_ICON_SIZES.favicon_ico.length) {
    const ico = buildIco(frames);
    if (ico.length <= BRANDING_ICON_MAX_BYTES) {
      out.push({
        key: "favicon_ico",
        contentType: "image/x-icon",
        data: ico,
        width: 48,
        height: 48,
      });
    }
  }
  return out;
}
