/*
 * Allow-list sanitiser for the brand `symbol` SVG. Unlike the denylist used for the other brand
 * images (`branding-asset.ts`, which refuses a file that holds anything executable), this one
 * REBUILDS the file: it parses the XML into a tree and writes out only the elements and attributes
 * named below, so whatever it does not know (script, foreignObject, image, use, filters, animation,
 * editor metadata) is gone from the result instead of having to be recognised as bad. The output is
 * what gets stored and what the worker rasterises.
 *
 *  - Elements: svg g path circle ellipse rect line polyline polygon defs linearGradient
 *    radialGradient stop clipPath mask title desc. `style` is dropped on purpose: CSS cannot be
 *    restricted to fill/stroke rules with a few lines of regex that I would trust; use attributes.
 *  - Attributes: geometry and presentation only, and every value must match a tiny character set
 *    (letters, digits, space and `# . , % ( ) + - _`), so `javascript:`, `data:`, URLs with a scheme,
 *    quotes, and markup cannot appear in a value at all. `url(...)` may only point at `#id`; `href`
 *    exists only on gradients and only as `#id`. No `on*`, no `style`, no `class`, no namespaces.
 *  - Refused outright (throws): DOCTYPE or ENTITY declarations (entity bombs, XXE), processing
 *    instructions other than the leading XML declaration, entity references other than the five
 *    predefined ones and numeric character references, malformed XML, too many elements or depth.
 */

export type SvgRejection = "invalid_svg" | "unsafe_svg";

/** Thrown for input the sanitiser will not rebuild. `reason` maps onto the upload error reasons. */
export class SvgRejected extends Error {
  constructor(readonly reason: SvgRejection) {
    super(reason);
  }
}

const reject = (reason: SvgRejection): SvgRejected => new SvgRejected(reason);

const ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "title",
  "desc",
]);

/** Elements whose text content is kept (escaped). Anywhere else text is dropped. */
const TEXT_ELEMENTS = new Set(["title", "desc"]);

const GEOMETRY = [
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "width",
  "height",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "transform",
];
const PRESENTATION = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "clip-path",
  "mask",
];
const GRADIENT = [
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "fx",
  "fy",
  "stop-color",
  "stop-opacity",
  "offset",
];
const CLIPPING = ["clipPathUnits", "maskUnits", "maskContentUnits"];
const COMMON = new Set([...GEOMETRY, ...PRESENTATION, ...GRADIENT, ...CLIPPING, "id"]);
const ROOT_ONLY = new Set(["viewBox", "preserveAspectRatio"]);

/** Everything a value may be made of; see the header for what this rules out. */
const SAFE_VALUE = /^[A-Za-z0-9\s#.,%()+\-_]*$/;
const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const LOCAL_REFERENCE = /^#[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const URL_CALL = /url\(\s*([^)]*?)\s*\)/gi;

const MAX_ATTRIBUTE_LENGTH = 20_000;
const MAX_ELEMENTS = 1_500;
const MAX_DEPTH = 24;
const MAX_INPUT = 524_288;

const NAME = "[A-Za-z_][A-Za-z0-9_.:-]*";
const START_TAG = new RegExp(`<(${NAME})`, "y");
const END_TAG = new RegExp(`</(${NAME})\\s*>`, "y");
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, "y");
const TAG_CLOSE = /\s*(\/?)>/y;

interface Node {
  name: string;
  attributes: Map<string, string>;
  children: (Node | string)[];
}

const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes the five predefined entities and numeric references; any other `&...;` is refused. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);/g,
    (_m, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
        const control = code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd;
        if (!Number.isInteger(code) || control || code > 0x10ffff) throw reject("unsafe_svg");
        return String.fromCodePoint(code);
      }
      const known = PREDEFINED[body];
      if (known === undefined) throw reject("unsafe_svg");
      return known;
    },
  );
}

/** Any `&` left after decoding means a reference the regex above did not accept. */
function assertNoStrayAmpersand(raw: string): void {
  const stripped = raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);/g, "");
  if (stripped.includes("&")) throw reject("invalid_svg");
}

function parse(text: string): Node {
  let index = 0;
  let root: Node | undefined;
  const stack: Node[] = [];
  let count = 0;

  while (index < text.length) {
    const open = text.indexOf("<", index);
    const between = text.slice(index, open === -1 ? text.length : open);
    const parent = stack.at(-1);
    if (parent === undefined) {
      if (between.trim() !== "") throw reject("invalid_svg");
    } else if (between !== "") {
      assertNoStrayAmpersand(between);
      parent.children.push(decodeEntities(between));
    }
    if (open === -1) break;
    index = open;

    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end === -1) throw reject("invalid_svg");
      index = end + 3;
    } else if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index);
      if (end === -1 || parent === undefined) throw reject("invalid_svg");
      parent.children.push(text.slice(index + "<![CDATA[".length, end));
      index = end + 3;
    } else if (text.startsWith("<?", index)) {
      // Only the XML declaration at the very start; anything else (xml-stylesheet, php) is refused.
      if (index !== 0 || !/^<\?xml\s[^<>]*\?>/.test(text)) throw reject("unsafe_svg");
      index = text.indexOf("?>") + 2;
    } else if (text.startsWith("<!", index)) {
      throw reject("unsafe_svg");
    } else if (text.startsWith("</", index)) {
      END_TAG.lastIndex = index;
      const match = END_TAG.exec(text);
      if (!match || stack.pop()?.name !== match[1]) throw reject("invalid_svg");
      index = END_TAG.lastIndex;
    } else {
      START_TAG.lastIndex = index;
      const name = START_TAG.exec(text)?.[1];
      if (name === undefined) throw reject("invalid_svg");
      if (root !== undefined && stack.length === 0) throw reject("invalid_svg");
      if (root === undefined && name !== "svg") throw reject("invalid_svg");
      if (++count > MAX_ELEMENTS || stack.length >= MAX_DEPTH) throw reject("unsafe_svg");

      const attributes = new Map<string, string>();
      let cursor = START_TAG.lastIndex;
      for (;;) {
        ATTRIBUTE.lastIndex = cursor;
        const attribute = ATTRIBUTE.exec(text);
        if (!attribute) break;
        const attributeName = attribute[1];
        if (attributeName === undefined || attributes.has(attributeName))
          throw reject("invalid_svg");
        const raw = attribute[2] ?? attribute[3] ?? "";
        assertNoStrayAmpersand(raw);
        attributes.set(attributeName, decodeEntities(raw));
        cursor = ATTRIBUTE.lastIndex;
      }
      TAG_CLOSE.lastIndex = cursor;
      const close = TAG_CLOSE.exec(text);
      if (!close) throw reject("invalid_svg");
      index = TAG_CLOSE.lastIndex;

      const node: Node = { name, attributes, children: [] };
      if (parent) parent.children.push(node);
      root ??= node;
      if (close[1] !== "/") stack.push(node);
    }
  }
  if (root === undefined || stack.length > 0) throw reject("invalid_svg");
  return root;
}

/** True when every `url(...)` in the value points at a local `#id`. */
function urlsAreLocal(value: string): boolean {
  for (const match of value.matchAll(URL_CALL)) {
    if (!LOCAL_REFERENCE.test(match[1] ?? "")) return false;
  }
  // A `url(` without its closing parenthesis never matched above.
  return (value.match(/url\(/gi)?.length ?? 0) === (value.match(URL_CALL)?.length ?? 0);
}

function attributeAllowed(element: string, name: string, value: string, isRoot: boolean): boolean {
  if (value.length > MAX_ATTRIBUTE_LENGTH || !SAFE_VALUE.test(value)) return false;
  if (name === "id") return ID.test(value);
  if (name === "href" || name === "xlink:href") {
    return (
      (element === "linearGradient" || element === "radialGradient") && LOCAL_REFERENCE.test(value)
    );
  }
  if (!urlsAreLocal(value)) return false;
  if (ROOT_ONLY.has(name)) return isRoot;
  return COMMON.has(name);
}

const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (text: string): string => escapeText(text).replaceAll('"', "&quot;");

function write(node: Node, isRoot: boolean): string {
  if (!ELEMENTS.has(node.name)) return "";
  const attributes: string[] = isRoot ? ['xmlns="http://www.w3.org/2000/svg"'] : [];
  for (const [name, value] of node.attributes) {
    if (!attributeAllowed(node.name, name, value, isRoot)) continue;
    // `xlink:href` becomes plain `href` (SVG 2), so no `xmlns:xlink` has to be declared.
    attributes.push(`${name === "xlink:href" ? "href" : name}="${escapeAttribute(value)}"`);
  }
  const inner = node.children
    .map((child) => {
      if (typeof child !== "string") return write(child, false);
      return TEXT_ELEMENTS.has(node.name) ? escapeText(child) : "";
    })
    .join("");
  const open = attributes.length > 0 ? `${node.name} ${attributes.join(" ")}` : node.name;
  return inner === "" ? `<${open}/>` : `<${open}>${inner}</${node.name}>`;
}

/**
 * The sanitised SVG text. Throws `SvgRejected` for malformed or dangerous input (see the header);
 * everything else outside the allow-list is silently left out of the result.
 */
export function sanitizeSvg(input: string): string {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.length > MAX_INPUT || text.includes("\u0000")) throw reject("invalid_svg");
  return write(parse(text), true);
}

export interface SvgGeometry {
  /** viewBox width and height, or `width`/`height` when there is no viewBox; null when unknown. */
  width: number | null;
  height: number | null;
}

/** Side lengths of a sanitised SVG (viewBox first, then plain `width`/`height`). */
export function svgGeometry(sanitized: string): SvgGeometry {
  const root = /<svg\s([^>]*)>/.exec(sanitized)?.[1] ?? "";
  const viewBox = /\sviewBox="([^"]*)"/
    .exec(` ${root}`)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4) {
    const [width, height] = [viewBox[2], viewBox[3]];
    if (width !== undefined && height !== undefined && width > 0 && height > 0) {
      return { width, height };
    }
  }
  const plain = (name: string): number | null => {
    const match = new RegExp(`\\s${name}="\\s*(\\d+(?:\\.\\d+)?)(?:px)?\\s*"`).exec(` ${root}`);
    return match?.[1] === undefined ? null : Number(match[1]);
  };
  return { width: plain("width"), height: plain("height") };
}
