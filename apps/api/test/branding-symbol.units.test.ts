import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { inspectAssetUpload } from "../src/branding/branding-asset.js";
import {
  contrastOnWhite,
  pngDominantColour,
  svgDominantColour,
} from "../src/branding/symbol-contrast.js";

import { dataUrl, ico, png } from "./support/branding-fixtures.js";

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function chunk(name: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A real, decodable solid-colour RGBA PNG (filter 0). */
function solid(side: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(side).fill([r, g, b, 255]).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(side).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (extra = "", viewBox = "0 0 100 100") =>
  `<svg ${NS} viewBox="${viewBox}"><circle cx="50" cy="50" r="40" ${extra}/></svg>`;

function reason(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { details?: { reason?: string } }).details?.reason ?? "other";
  }
  return undefined;
}

describe("contrast", () => {
  it("rates white on white 1:1 and black 21:1", () => {
    expect(contrastOnWhite([255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrastOnWhite([0, 0, 0])).toBeCloseTo(21, 5);
  });

  it("reads the dominant colour of an SVG and of a decodable PNG", () => {
    expect(svgDominantColour(svg('fill="#fff"'))).toEqual([255, 255, 255]);
    expect(svgDominantColour(svg())).toEqual([0, 0, 0]);
    expect(pngDominantColour(solid(8, [250, 250, 200]))).toEqual([250, 250, 200]);
    expect(pngDominantColour(png(512, 512))).toBeUndefined();
  });
});

describe("symbol upload", () => {
  it("accepts a square SVG, stores the sanitised bytes and warns about a pale one", () => {
    const dark = inspectAssetUpload("symbol", dataUrl("image/svg+xml", svg('fill="#1e3a8a"')));
    expect(dark).toMatchObject({
      contentType: "image/svg+xml",
      width: 100,
      height: 100,
      warnings: [],
    });

    const pale = inspectAssetUpload(
      "symbol",
      dataUrl(
        "image/svg+xml",
        `<svg ${NS} viewBox="0 0 10 10" onload="x()"><script/><rect fill="#fefefe"/></svg>`,
      ),
    );
    expect(pale.warnings).toEqual(["low_contrast"]);
    expect(pale.data.toString()).not.toContain("script");
  });

  it("refuses a non-square SVG, an SVG over 10 KB once sanitised, and unsafe markup", () => {
    expect(
      reason(() => inspectAssetUpload("symbol", dataUrl("image/svg+xml", svg("", "0 0 100 60")))),
    ).toBe("not_square");
    const big = `<svg ${NS} viewBox="0 0 10 10">${'<path d="M0 0 L1 1"/>'.repeat(700)}</svg>`;
    expect(reason(() => inspectAssetUpload("symbol", dataUrl("image/svg+xml", big)))).toBe(
      "too_large",
    );
    expect(
      reason(() =>
        inspectAssetUpload("symbol", dataUrl("image/svg+xml", `<!DOCTYPE svg><svg ${NS}/>`)),
      ),
    ).toBe("unsafe_svg");
  });

  it("takes a square PNG of at least 512 px and warns on a pale decodable one", () => {
    expect(inspectAssetUpload("symbol", dataUrl("image/png", png(512, 512)))).toMatchObject({
      width: 512,
      warnings: [],
    });
    const pale = inspectAssetUpload("symbol", dataUrl("image/png", solid(512, [250, 250, 200])));
    expect(pale.warnings).toEqual(["low_contrast"]);
    expect(reason(() => inspectAssetUpload("symbol", dataUrl("image/png", png(256, 256))))).toBe(
      "too_small",
    );
    expect(reason(() => inspectAssetUpload("symbol", dataUrl("image/png", png(512, 600))))).toBe(
      "not_square",
    );
    expect(reason(() => inspectAssetUpload("symbol", dataUrl("image/x-icon", ico())))).toBe(
      "unsupported_type",
    );
  });
});

describe("icon keys", () => {
  it("want PNG of exactly their size, square", () => {
    expect(inspectAssetUpload("icon_192", dataUrl("image/png", png(192, 192)))).toMatchObject({
      width: 192,
    });
    expect(reason(() => inspectAssetUpload("icon_192", dataUrl("image/png", png(180, 180))))).toBe(
      "wrong_size",
    );
    expect(reason(() => inspectAssetUpload("icon_192", dataUrl("image/png", png(192, 100))))).toBe(
      "not_square",
    );
    expect(
      inspectAssetUpload("apple_touch_icon", dataUrl("image/png", png(180, 180))),
    ).toMatchObject({
      width: 180,
    });
    expect(
      reason(() => inspectAssetUpload("apple_touch_icon", dataUrl("image/svg+xml", svg()))),
    ).toBe("unsupported_type");
  });

  it("take an ICO only for favicon_ico, and 20 KB at most per icon", () => {
    expect(inspectAssetUpload("favicon_ico", dataUrl("image/x-icon", ico())).contentType).toBe(
      "image/x-icon",
    );
    expect(reason(() => inspectAssetUpload("icon_48", dataUrl("image/x-icon", ico())))).toBe(
      "unsupported_type",
    );
    const heavy = Buffer.concat([png(48, 48), Buffer.alloc(21_000)]);
    expect(reason(() => inspectAssetUpload("icon_48", dataUrl("image/png", heavy)))).toBe(
      "too_large",
    );
  });

  it("restrict the other new keys by type", () => {
    expect(
      reason(() => inspectAssetUpload("email_logo", dataUrl("image/webp", Buffer.alloc(30)))),
    ).toBe("unsupported_type");
    expect(reason(() => inspectAssetUpload("og_default", dataUrl("image/svg+xml", svg())))).toBe(
      "unsupported_type",
    );
  });
});
