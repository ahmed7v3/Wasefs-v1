import { readFileSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { processImage } from "../src/images/process-image.js";

/*
 * A real HEIC photo end to end through the image pipeline. The fixture is libheif's own example
 * (github.com/strukturag/libheif, examples/example.heic, LGPL-3.0), used here only as test data.
 */

const photo = readFileSync(new URL("./fixtures/sample.heic", import.meta.url));

describe("HEIC photo", () => {
  it("becomes the usual JPEG: decoded, scaled to the long edge, metadata dropped", async () => {
    const processed = await processImage(photo, "image/heic");

    const meta = await sharp(processed.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(processed.width, processed.height)).toBeLessThanOrEqual(2048);
    expect(processed.width).toBeGreaterThan(100);
    expect(meta.exif).toBeUndefined();
    expect(processed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(processed.dhash).toMatch(/^[0-9a-f]{16}$/);
  }, 30_000);

  it("is accepted when the import stored it under the JPEG row mime", async () => {
    const processed = await processImage(photo, "image/jpeg");
    expect(processed.jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
  }, 30_000);
});
