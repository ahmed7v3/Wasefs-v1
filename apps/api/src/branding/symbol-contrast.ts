import { inflateSync } from "node:zlib";

/*
 * Non-blocking contrast check of the brand symbol on a white page (the browser tab, a search
 * result): the symbol's dominant colour against #fff must reach WCAG's 3:1 for graphics. The api has
 * no image library, so the colour is read two cheap ways: from the colour attributes of a sanitised
 * SVG (the most used fill or stroke), and from the pixels of an 8-bit non-interlaced PNG (the most
 * common coarse colour among the opaque pixels). Anything else (WebP, 16-bit or interlaced PNG,
 * a huge image) gives no verdict: the answer is "no warning", never a wrong one.
 */

export const MIN_GRAPHIC_CONTRAST = 3;

type Rgb = readonly [number, number, number];

const NAMED: Record<string, Rgb> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  navy: [0, 0, 128],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  gold: [255, 215, 0],
};

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of `colour` on white. */
export function contrastOnWhite(colour: Rgb): number {
  return 1.05 / (luminance(colour) + 0.05);
}

export function isLowContrast(colour: Rgb): boolean {
  return contrastOnWhite(colour) < MIN_GRAPHIC_CONTRAST;
}

function parseColour(value: string): Rgb | undefined {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(text);
  if (rgb?.[1] !== undefined && rgb[2] !== undefined && rgb[3] !== undefined) {
    return [Math.min(255, +rgb[1]), Math.min(255, +rgb[2]), Math.min(255, +rgb[3])];
  }
  return NAMED[text];
}

/** The most used colour among the `fill`/`stroke` attributes of a sanitised SVG; black when there are none (the SVG default). */
export function svgDominantColour(sanitized: string): Rgb {
  const counts = new Map<string, { colour: Rgb; n: number }>();
  for (const match of sanitized.matchAll(/\s(?:fill|stroke)="([^"]*)"/g)) {
    const colour = parseColour(match[1] ?? "");
    if (!colour) continue;
    const id = colour.join(",");
    const entry = counts.get(id) ?? { colour, n: 0 };
    entry.n += 1;
    counts.set(id, entry);
  }
  let best: { colour: Rgb; n: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best?.colour ?? [0, 0, 0];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Pixels inflated at most; a larger image gives no verdict. */
const MAX_PIXELS = 4_194_304;

/** Bytes per pixel of the PNG colour types this reads (8-bit only). */
const SAMPLES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** The most common coarse (4 bits per channel) opaque colour of a PNG, or undefined when it cannot be read. */
export function pngDominantColour(data: Buffer): Rgb | undefined {
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let interlace = 1;
  let palette: Buffer | undefined;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const name = data.toString("latin1", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (body.length < length) return undefined;
    if (name === "IHDR" && length >= 13) {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8] ?? 0;
      type = body[9] ?? -1;
      interlace = body[12] ?? 1;
    } else if (name === "PLTE") palette = Buffer.from(body);
    else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    offset += 12 + length;
  }
  const samples = SAMPLES[type];
  if (samples === undefined || depth !== 8 || interlace !== 0) return undefined;
  if (width < 1 || height < 1 || width * height > MAX_PIXELS) return undefined;
  if (type === 3 && palette === undefined) return undefined;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: width * height * 4 + height + 1 });
  } catch {
    return undefined;
  }
  const stride = width * samples;
  if (raw.length < (stride + 1) * height) return undefined;

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start] ?? 0;
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= samples ? (line[x - samples] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= samples ? (previous[x - samples] ?? 0) : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) add = paeth(left, up, upLeft);
      else if (filter !== 0) return undefined;
      line[x] = ((line[x] ?? 0) + add) & 0xff;
    }
    previous = line;
    for (let x = 0; x < width; x += 1) {
      const base = x * samples;
      let r: number;
      let g: number;
      let b: number;
      let alpha = 255;
      if (type === 6) {
        [r, g, b, alpha] = [
          line[base] ?? 0,
          line[base + 1] ?? 0,
          line[base + 2] ?? 0,
          line[base + 3] ?? 0,
        ];
      } else if (type === 2) {
        [r, g, b] = [line[base] ?? 0, line[base + 1] ?? 0, line[base + 2] ?? 0];
      } else if (type === 0 || type === 4) {
        r = g = b = line[base] ?? 0;
        if (type === 4) alpha = line[base + 1] ?? 0;
      } else {
        const index = (line[base] ?? 0) * 3;
        [r, g, b] = [palette?.[index] ?? 0, palette?.[index + 1] ?? 0, palette?.[index + 2] ?? 0];
      }
      if (alpha < 128) continue;
      const id = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(id) ?? { r: 0, g: 0, b: 0, n: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n += 1;
      buckets.set(id, bucket);
    }
  }
  let best: { r: number; g: number; b: number; n: number } | undefined;
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return undefined;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}
