import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  BRANDING_ASSET_MAX_BYTES,
  BRANDING_ASSET_TYPES,
  type BrandingAssetKey,
  type BrandingAssetType,
} from "@wasfa/shared/schemas/branding";

/*
 * Checks of an uploaded brand image, before a single byte is stored. The declared type must match
 * the file's magic bytes (a renamed file is refused), raster dimensions are read from the header
 * (so pages can reserve the space), and SVG gets a strict denylist: SVG is XML that can carry
 * script, so it is parsed by a small well-formedness scanner and refused when it holds anything
 * executable or external. The denylist is deliberately blunt (no sanitising, no allowlist of
 * elements): an admin whose logo trips it exports a plain SVG instead. The public route serves SVG
 * under `default-src 'none'; sandbox` as well, so this is the second layer, not the only one.
 */

export type RejectReason =
  | "unsupported_type"
  | "invalid_data"
  | "type_mismatch"
  | "too_large"
  | "invalid_svg"
  | "unsafe_svg";

function reject(reason: RejectReason): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["dataUrl"], reason } });
}

export interface InspectedAsset {
  contentType: BrandingAssetType;
  data: Buffer;
  width: number | null;
  height: number | null;
}

/** Largest side a stored dimension may have (matches the `branding` setting's schema). */
const MAX_SIDE = 8_192;

function side(value: number): number | null {
  const rounded = Math.round(value);
  return Number.isFinite(rounded) && rounded >= 1 && rounded <= MAX_SIDE ? rounded : null;
}

function isAllowedType(value: string): value is BrandingAssetType {
  return (BRANDING_ASSET_TYPES as readonly string[]).includes(value);
}

/** Splits `data:<type>;base64,<payload>` and decodes it. The shape was already checked by the zod schema. */
export function decodeDataUrl(dataUrl: string): { declared: string; data: Buffer } {
  const comma = dataUrl.indexOf(",");
  const declared = dataUrl.slice("data:".length, dataUrl.indexOf(";"));
  const payload = dataUrl.slice(comma + 1);
  if (payload.length % 4 !== 0) throw reject("invalid_data");
  return { declared, data: Buffer.from(payload, "base64") };
}

// --- Raster headers ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_SIGNATURE = Buffer.from([0x00, 0x00, 0x01, 0x00]);

function startsWith(data: Buffer, signature: Buffer): boolean {
  return data.length >= signature.length && data.subarray(0, signature.length).equals(signature);
}

function pngSize(data: Buffer): [number | null, number | null] {
  // 8 signature bytes, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4).
  if (data.length < 24 || data.toString("latin1", 12, 16) !== "IHDR") return [null, null];
  return [side(data.readUInt32BE(16)), side(data.readUInt32BE(20))];
}

function isWebp(data: Buffer): boolean {
  return (
    data.length >= 16 &&
    data.toString("latin1", 0, 4) === "RIFF" &&
    data.toString("latin1", 8, 12) === "WEBP"
  );
}

function webpSize(data: Buffer): [number | null, number | null] {
  const format = data.toString("latin1", 12, 16);
  if (format === "VP8X" && data.length >= 30) {
    return [side(data.readUIntLE(24, 3) + 1), side(data.readUIntLE(27, 3) + 1)];
  }
  if (format === "VP8 " && data.length >= 30) {
    return [side(data.readUInt16LE(26) & 0x3fff), side(data.readUInt16LE(28) & 0x3fff)];
  }
  if (format === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return [side((bits & 0x3fff) + 1), side(((bits >>> 14) & 0x3fff) + 1)];
  }
  return [null, null];
}

// --- SVG --------------------------------------------------------------------------------------

const NAME = "[A-Za-z_][A-Za-z0-9_.:-]*";
const START_TAG = new RegExp(`<(${NAME})`, "y");
const END_TAG = new RegExp(`</(${NAME})\\s*>`, "y");
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, "y");
const TAG_CLOSE = /\s*(\/?)>/y;

interface SvgRoot {
  attributes: Map<string, string>;
}

/**
 * A minimal XML well-formedness scan: one root element named `svg`, balanced tags, quoted unique
 * attributes, nothing but whitespace and comments around the root, no DOCTYPE, and no processing
 * instruction except a leading `<?xml ... ?>`. Not a validator: only enough to be sure the file is
 * XML with an `<svg>` root before the denylist runs over it.
 */
function scanSvg(text: string): SvgRoot {
  const stack: string[] = [];
  let root: SvgRoot | undefined;
  let rootClosed = false;
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf("<", index);
    const between = text.slice(index, open === -1 ? text.length : open);
    // Text is only allowed inside an element; around the root there is whitespace at most.
    if (stack.length === 0 && between.trim() !== "") throw reject("invalid_svg");
    if (open === -1) break;
    index = open;

    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end === -1) throw reject("invalid_svg");
      index = end + 3;
    } else if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index);
      if (end === -1 || stack.length === 0) throw reject("invalid_svg");
      index = end + 3;
    } else if (text.startsWith("<?", index)) {
      // Only the XML declaration at the very start: `<?xml-stylesheet` would pull in external CSS.
      if (index !== 0 || !/^<\?xml\s[^<>]*\?>/.test(text)) throw reject("unsafe_svg");
      index = text.indexOf("?>") + 2;
    } else if (text.startsWith("<!", index)) {
      throw reject("unsafe_svg");
    } else if (text.startsWith("</", index)) {
      END_TAG.lastIndex = index;
      const match = END_TAG.exec(text);
      if (!match || stack.pop() !== match[1]) throw reject("invalid_svg");
      index = END_TAG.lastIndex;
      if (stack.length === 0) rootClosed = true;
    } else {
      if (rootClosed) throw reject("invalid_svg");
      START_TAG.lastIndex = index;
      const start = START_TAG.exec(text);
      const name = start?.[1];
      if (name === undefined) throw reject("invalid_svg");
      if (root === undefined && name !== "svg") throw reject("invalid_svg");

      const attributes = new Map<string, string>();
      let cursor = START_TAG.lastIndex;
      for (;;) {
        ATTRIBUTE.lastIndex = cursor;
        const attribute = ATTRIBUTE.exec(text);
        if (!attribute) break;
        const attributeName = attribute[1];
        if (attributeName === undefined || attributes.has(attributeName))
          throw reject("invalid_svg");
        attributes.set(attributeName, attribute[2] ?? attribute[3] ?? "");
        cursor = ATTRIBUTE.lastIndex;
      }
      TAG_CLOSE.lastIndex = cursor;
      const close = TAG_CLOSE.exec(text);
      if (!close) throw reject("invalid_svg");
      index = TAG_CLOSE.lastIndex;

      root ??= { attributes };
      if (close[1] === "/") {
        if (stack.length === 0) rootClosed = true;
      } else {
        stack.push(name);
      }
    }
  }
  if (root === undefined || stack.length > 0 || !rootClosed) throw reject("invalid_svg");
  return root;
}

/** Numeric character references decoded, so `&#106;avascript:` is seen as what a browser sees. */
function decodeCharacterReferences(text: string): string {
  const char = (code: number) =>
    Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => char(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => char(Number.parseInt(decimal, 10)));
}

const SVG_DENYLIST: readonly RegExp[] = [
  /<\s*script/i,
  /<\s*foreignobject/i,
  /<\s*(?:iframe|embed|object|link|meta)\b/i,
  // Event handler attributes: `onload=`, `onclick=`, ... (no SVG attribute starts with "on" otherwise).
  /[\s"'/]on[a-z]+\s*=/i,
  /(?:java|vb)script\s*:|data\s*:\s*text\/html/i,
  // SMIL can rewrite an `href` at run time.
  /attributename\s*=\s*["']\s*(?:xlink:)?href/i,
  /@import/i,
  // CSS `url(...)` may only point at the file itself (`url(#gradient)`).
  /url\(\s*(?!["']?\s*#)/i,
];

const HREF = /(?:^|[\s"'/])(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function holdsUnsafeMarkup(text: string): boolean {
  if (SVG_DENYLIST.some((pattern) => pattern.test(text))) return true;
  // Every link must stay inside the file (`#id`); nothing external, no `data:` payloads.
  return [...text.matchAll(HREF)].some(
    (match) => !(match[1] ?? match[2] ?? "").trim().startsWith("#"),
  );
}

function svgSize(root: SvgRoot): [number | null, number | null] {
  const viewBox = root.attributes
    .get("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4) {
    const [width, height] = [viewBox[2], viewBox[3]];
    if (width !== undefined && height !== undefined && width > 0 && height > 0) {
      return [side(width), side(height)];
    }
  }
  const plain = (name: string) => {
    const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(root.attributes.get(name) ?? "");
    return match?.[1] === undefined ? null : side(Number(match[1]));
  };
  return [plain("width"), plain("height")];
}

function inspectSvg(data: Buffer): [number | null, number | null] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data);
  } catch {
    // Binary data under an SVG label (a PNG renamed, for one) is not UTF-8.
    throw reject("type_mismatch");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\u0000")) throw reject("invalid_svg");

  const root = scanSvg(text);
  if (holdsUnsafeMarkup(text) || holdsUnsafeMarkup(decodeCharacterReferences(text))) {
    throw reject("unsafe_svg");
  }
  return svgSize(root);
}

// --- Entry point ------------------------------------------------------------------------------

/**
 * Decodes and verifies an upload for `key`: allowed type (ICO only for the favicon), size, magic
 * bytes of that type, and for SVG the denylist. Throws `VALIDATION_FAILED` with
 * `details = { fields: ["dataUrl"], reason }`; the submitted bytes are never echoed.
 */
export function inspectAssetUpload(key: BrandingAssetKey, dataUrl: string): InspectedAsset {
  const { declared, data } = decodeDataUrl(dataUrl);
  if (!isAllowedType(declared) || (declared === "image/x-icon" && key !== "favicon")) {
    throw reject("unsupported_type");
  }
  if (data.length === 0 || data.length > BRANDING_ASSET_MAX_BYTES) throw reject("too_large");

  switch (declared) {
    case "image/png": {
      if (!startsWith(data, PNG_SIGNATURE)) throw reject("type_mismatch");
      const [width, height] = pngSize(data);
      return { contentType: declared, data, width, height };
    }
    case "image/webp": {
      if (!isWebp(data)) throw reject("type_mismatch");
      const [width, height] = webpSize(data);
      return { contentType: declared, data, width, height };
    }
    case "image/x-icon": {
      if (!startsWith(data, ICO_SIGNATURE)) throw reject("type_mismatch");
      return { contentType: declared, data, width: null, height: null };
    }
    case "image/svg+xml": {
      const [width, height] = inspectSvg(data);
      return { contentType: declared, data, width, height };
    }
  }
}
