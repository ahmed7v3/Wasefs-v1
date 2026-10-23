// Renders the bundled favicon / app-icon defaults from brand/symbol.svg with sharp.
// Run from the worker package (it already depends on sharp); nothing is added to any package.json:
//   pnpm --filter @wasfa/worker exec node ../../brand/scripts/build-icons.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `sharp` is resolved from the package the script is run in (cwd), not from brand/scripts.
const sharp = createRequire(path.resolve(process.cwd(), "package.json"))("sharp");

const here = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.resolve(here, "..");
const outDir = path.resolve(here, "../../apps/web/src/brand-defaults");
const publicDir = path.resolve(here, "../../apps/web/public");
fs.mkdirSync(outDir, { recursive: true });

const PRIMARY = "#1e3a8a";
const BUDGET = 20 * 1024;

const symbol = fs.readFileSync(path.join(brandDir, "symbol.svg"), "utf8");
// The white strokes only (the tile is drawn separately for the full-bleed variants).
const glyph = /<g [^>]*>.*<\/g>/s.exec(symbol)?.[0];
if (glyph === undefined) throw new Error("symbol.svg has no glyph group");
// Glyph bounds on the 24 grid, used to centre it on the full-bleed backgrounds.
const GLYPH_CENTER = { x: 12.35, y: 11.45 };

/** Navy square with the glyph centred at `scale` px per grid unit (no rounded corners). */
function fullBleed(size, scale) {
  const tx = size / 2 - GLYPH_CENTER.x * scale;
  const ty = size / 2 - GLYPH_CENTER.y * scale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${PRIMARY}"/><g transform="translate(${tx} ${ty}) scale(${scale})">${glyph}</g></svg>`,
  );
}

async function png(input, size, intrinsic = 24) {
  return sharp(input, { density: Math.ceil((72 * size) / intrinsic) })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

/** An ICO whose images are PNGs (supported since Vista and by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const outputs = new Map();
for (const size of [48, 96, 192, 512]) {
  outputs.set(`icon-${size}.png`, await png(Buffer.from(symbol), size));
}
outputs.set("icon-maskable-512.png", await png(fullBleed(512, 17), 512, 512));
outputs.set("apple-touch-icon.png", await png(fullBleed(180, 7.2), 180, 180));
outputs.set(
  "favicon.ico",
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(Buffer.from(symbol), size) })),
    ),
  ),
);
// A lighter tile edge keeps the icon visible on dark browser tabs.
outputs.set(
  "icon.svg",
  Buffer.from(
    symbol
      .replace(
        /<title>/,
        "<style>@media (prefers-color-scheme: dark){rect{stroke:#60a5fa;stroke-width:1}}</style><title>",
      )
      .trim(),
  ),
);

for (const [name, data] of outputs) {
  if (data.length > BUDGET) throw new Error(`${name} is ${data.length} bytes (budget ${BUDGET})`);
  fs.writeFileSync(path.join(outDir, name), data);
  process.stdout.write(`${name} ${data.length}\n`);
}

// The Organization JSON-LD logo keeps its path: the 512 px symbol, transparent corners.
const logo = await png(Buffer.from(symbol), 512);
fs.writeFileSync(path.join(publicDir, "logo.png"), logo);
process.stdout.write(`logo.png ${logo.length}\n`);
process.exit(0);
