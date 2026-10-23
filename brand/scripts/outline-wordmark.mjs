// One-off generator of the logo masters (brand/*.svg and apps/web/public/brand/*.svg).
// The wordmarks are IBM Plex Sans Arabic Bold converted to outlines, so the SVGs have no font
// dependency. opentype.js does not shape a whole Arabic string in a way we can trust for layout:
// it does pick the contextual forms (init/medi/fina) in `stringToGlyphs`, returned in visual
// left-to-right order, and we place the glyphs ourselves by their advance widths.
//
// Not part of any package: see brand/README.md for the exact commands (opentype.js via a temp dir).
//
//   node outline-wordmark.mjs <path-to-IBMPlexSansArabic-Bold.ttf> <path-to-opentype.js-entry>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [, , fontPath, openTypeEntry] = process.argv;
if (!fontPath || !openTypeEntry) {
  throw new Error("usage: outline-wordmark.mjs <font.ttf> <opentype.js entry (module path)>");
}
const openTypeModule = await import(pathToFileURL(path.resolve(openTypeEntry)).href);
const opentype = openTypeModule.default ?? openTypeModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.resolve(here, "..");
const publicDir = path.resolve(here, "../../apps/web/public/brand");
fs.mkdirSync(publicDir, { recursive: true });

const PRIMARY = "#1e3a8a";
const ACCENT = "#60a5fa";

const bytes = fs.readFileSync(fontPath);
const font = opentype.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const TILE = 56; // lockup height = tile edge
const FONT_SIZE = 38;
const GAP_TILE = 14;
const GAP_WORDS = 11;
const scale = FONT_SIZE / font.unitsPerEm;
const capHeight = (font.tables.os2?.sCapHeight ?? 700) * scale;
const baseline = TILE / 2 + capHeight / 2;

const r = (n) => Math.round(n * 100) / 100;

/** Outline of the Arabic word, left edge at x; the glyphs come back in visual order. */
function arabic(text, x) {
  let cursor = x;
  let d = "";
  for (const glyph of font.stringToGlyphs(text)) {
    d += glyph.getPath(cursor, baseline, FONT_SIZE).toPathData(2);
    cursor += glyph.advanceWidth * scale;
  }
  return { d, width: cursor - x };
}

/** Outline of a Latin run (kerning applied), left edge at x. */
function latin(text, x) {
  const p = font.getPath(text, x, baseline, FONT_SIZE);
  return { d: p.toPathData(2), width: font.getAdvanceWidth(text, FONT_SIZE) };
}

function glyphStrokes(stroke) {
  return `<g fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.6" cy="8.8" r="3.3"/><path d="M11.9 8.8C12.7 11.6 12.5 14.8 11.6 17.4L19.4 7.4"/></g>`;
}

const SYMBOL_BODY = `<rect width="24" height="24" rx="5.5" fill="${PRIMARY}"/>${glyphStrokes("#fff")}`;

function tile(x, variant, maskId) {
  const s = TILE / 24;
  const open = `<g transform="translate(${r(x)} 0) scale(${r(s)})">`;
  if (variant === "mono") {
    return `<mask id="${maskId}"><rect width="24" height="24" fill="#fff"/>${glyphStrokes("#000")}</mask>${open}<rect width="24" height="24" rx="5.5" fill="currentColor" mask="url(#${maskId})"/></g>`;
  }
  const edge = variant === "dark" ? ` stroke="${ACCENT}" stroke-width="0.6"` : "";
  return `${open}<rect width="24" height="24" rx="5.5" fill="${PRIMARY}"${edge}/>${glyphStrokes("#fff")}</g>`;
}

function lockup(lang, variant) {
  const ink = variant === "mono" ? "currentColor" : variant === "dark" ? "#fff" : PRIMARY;
  const title = lang === "ar" ? "وصفة AI" : "Wasfa AI";
  let body;
  let width;
  if (lang === "ar") {
    // RTL: the tile sits on the right, then «وصفة», then "AI" to its left.
    const ai = latin("AI", 0);
    const word = arabic("وصفة", ai.width + GAP_WORDS);
    const tileX = ai.width + GAP_WORDS + word.width + GAP_TILE;
    width = tileX + TILE;
    body = `<path fill="${ink}" d="${latin("AI", 0).d}${word.d}"/>${tile(tileX, variant, "m")}`;
  } else {
    const text = latin("Wasfa AI", TILE + GAP_TILE);
    width = TILE + GAP_TILE + text.width;
    body = `${tile(0, variant, "m")}<path fill="${ink}" d="${text.d}"/>`;
  }
  const w = Math.ceil(width);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${TILE}" width="${w}" height="${TILE}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
}

const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Wasfa AI"><title>Wasfa AI</title>${SYMBOL_BODY}</svg>\n`;

const files = {
  "symbol.svg": symbol,
  "logo-ar.svg": lockup("ar", "color"),
  "logo-en.svg": lockup("en", "color"),
  "logo-ar-mono.svg": lockup("ar", "mono"),
  "logo-en-mono.svg": lockup("en", "mono"),
  "logo-ar-dark.svg": lockup("ar", "dark"),
};
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(brandDir, name), content);
  fs.writeFileSync(path.join(publicDir, name), content);
}
process.stdout.write(`wrote ${Object.keys(files).length} files\n`);

// ---- Direction drafts (brand/directions): A is the symbol above, B and C are alternatives. ----

const SHEET_BODY = `<rect width="24" height="24" rx="5.5" fill="${PRIMARY}"/><path d="M6.5 4.5H14l4.5 4.5v10.5h-12z" fill="#fff"/><path d="M14 4.5V9h4.5z" fill="#bfdbfe"/><rect x="4.2" y="11" width="15.6" height="1.7" rx=".85" fill="${ACCENT}"/><path d="M9.2 16.2l1.9 1.9 3.8-4" fill="none" stroke="${PRIMARY}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;

function symbolSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>\n`;
}

/** Tile on the right (RTL), «وصفة» then "AI" to its left; same layout as the A masters. */
function directionLockup(body, ink) {
  const ai = latin("AI", 0);
  const word = arabic("وصفة", ai.width + GAP_WORDS);
  const tileX = ai.width + GAP_WORDS + word.width + GAP_TILE;
  const w = Math.ceil(tileX + TILE);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${TILE}" width="${w}" height="${TILE}"><path fill="${ink}" d="${ai.d}${word.d}"/><g transform="translate(${r(tileX)} 0) scale(${r(TILE / 24)})">${body}</g></svg>\n`;
}

const COMMAND_POINTS = {
  M: ["x", "y"],
  L: ["x", "y"],
  C: ["x1", "y1", "x2", "y2", "x", "y"],
  Q: ["x1", "y1", "x", "y"],
  Z: [],
};

/** Direction C: «وصفة» with the two dots of the ة replaced by a small check badge. */
function wordmarkC(ink) {
  let cursor = 0;
  let d = "";
  let badge = null;
  font.stringToGlyphs("وصفة").forEach((glyph, i) => {
    if (i !== 0) {
      d += glyph.getPath(cursor, baseline, FONT_SIZE).toPathData(2);
    } else {
      // ة: drop the dot contours (small, above the x-height) and remember where they were.
      const contours = [];
      let current = [];
      for (const cmd of glyph.path.commands) {
        current.push(cmd);
        if (cmd.type === "Z") {
          contours.push(current);
          current = [];
        }
      }
      for (const contour of contours) {
        const ys = contour.flatMap((c) =>
          ["y", "y1", "y2"].map((k) => c[k]).filter((v) => v !== undefined),
        );
        const xs = contour.flatMap((c) =>
          ["x", "x1", "x2"].map((k) => c[k]).filter((v) => v !== undefined),
        );
        const isDot = Math.max(...ys) - Math.min(...ys) < 230 && Math.min(...ys) > 420;
        if (isDot) {
          badge = {
            x: cursor + ((Math.min(...xs) + Math.max(...xs)) / 2) * scale,
            y: baseline - Math.max(...ys) * scale,
          };
          continue;
        }
        for (const c of contour) {
          d += c.type;
          d += COMMAND_POINTS[c.type]
            .map((k) => r(k.startsWith("y") ? baseline - c[k] * scale : cursor + c[k] * scale))
            .join(" ");
        }
      }
    }
    cursor += glyph.advanceWidth * scale;
  });
  const bx = badge?.x ?? cursor / 2;
  const by = (badge?.y ?? 6) - 4;
  const w = Math.ceil(cursor);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${TILE}" width="${w}" height="${TILE}"><path fill="${ink}" d="${d}"/><circle cx="${r(bx)}" cy="${r(by)}" r="6.5" fill="${ACCENT}"/><path d="M${r(bx - 3)} ${r(by + 0.2)}l2.2 2.3 4-4.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
}

const directions = {
  "a-waw-check.svg": symbolSvg(SYMBOL_BODY),
  "a-waw-check-lockup.svg": directionLockup(SYMBOL_BODY, PRIMARY),
  "a-waw-check-lockup-dark.svg": directionLockup(SYMBOL_BODY, "#fff"),
  "b-sheet-scan.svg": symbolSvg(SHEET_BODY),
  "b-sheet-scan-lockup.svg": directionLockup(SHEET_BODY, PRIMARY),
  "b-sheet-scan-lockup-dark.svg": directionLockup(SHEET_BODY, "#fff"),
  "c-wordmark.svg": wordmarkC(PRIMARY),
  "c-wordmark-dark.svg": wordmarkC("#fff"),
};
fs.mkdirSync(path.join(brandDir, "directions"), { recursive: true });
for (const [name, content] of Object.entries(directions)) {
  fs.writeFileSync(path.join(brandDir, "directions", name), content);
}
process.stdout.write(`wrote ${Object.keys(directions).length} direction files\n`);
