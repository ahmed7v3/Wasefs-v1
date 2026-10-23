import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { OG_MAX_BYTES } from "../src/og/render.js";

import { OG_CASES, renderCase } from "./support/og-cases.js";

/*
 * Snapshots live in test/__og__. After an intended change to a template, the frame or the fonts:
 *   OG_UPDATE=1 pnpm --filter @wasfa/worker exec vitest run test/og.render.test.ts
 * and look at the new PNGs before committing them.
 */
const SNAPSHOT_DIR = fileURLToPath(new URL("./__og__/", import.meta.url));
/** A pixel counts as different above this per-channel step (anti-aliasing noise stays below it). */
const CHANNEL_TOLERANCE = 24;
/** Share of pixels allowed to differ (font hinting differences between libvips builds). */
const PIXEL_BUDGET = 0.002;

async function rawPixels(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe("og render", () => {
  it.each(OG_CASES.map((ogCase) => [ogCase.name, ogCase] as const))(
    "%s is a 1200x630 PNG under 300 KB and matches its snapshot",
    async (name, ogCase) => {
      const { png, hash } = await renderCase(ogCase);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      const metadata = await sharp(png).metadata();
      expect(metadata.format).toBe("png");
      expect([metadata.width, metadata.height]).toEqual([1200, 630]);
      expect(png.byteLength).toBeLessThan(OG_MAX_BYTES);

      const file = `${SNAPSHOT_DIR}${name}.png`;
      if (process.env["OG_UPDATE"] === "1") {
        await mkdir(SNAPSHOT_DIR, { recursive: true });
        await writeFile(file, png);
        return;
      }
      const expected = await rawPixels(await readFile(file));
      const actual = await rawPixels(png);
      expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
      let different = 0;
      for (let index = 0; index < actual.data.length; index += 3) {
        const step = Math.max(
          Math.abs((actual.data[index] ?? 0) - (expected.data[index] ?? 0)),
          Math.abs((actual.data[index + 1] ?? 0) - (expected.data[index + 1] ?? 0)),
          Math.abs((actual.data[index + 2] ?? 0) - (expected.data[index + 2] ?? 0)),
        );
        if (step > CHANNEL_TOLERANCE) different += 1;
      }
      expect(different / (actual.width * actual.height)).toBeLessThanOrEqual(PIXEL_BUDGET);
    },
  );

  it("renders the same card byte-for-byte twice (the hash can key a cache)", async () => {
    const first = OG_CASES[0];
    if (first === undefined) throw new Error("missing case");
    const a = await renderCase(first);
    const b = await renderCase(first);
    expect(a.hash).toBe(b.hash);
    expect(a.png.equals(b.png)).toBe(true);
  });

  it("gives the Arabic and English cards of one page different hashes", async () => {
    const [ar, en] = [OG_CASES[0], OG_CASES[1]];
    if (ar === undefined || en === undefined) throw new Error("missing case");
    expect((await renderCase(ar)).hash).not.toBe((await renderCase(en)).hash);
  });
});
