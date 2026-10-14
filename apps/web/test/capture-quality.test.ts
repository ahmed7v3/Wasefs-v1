import { describe, expect, it } from "vitest";

import {
  QUALITY_THRESHOLDS,
  assessQuality,
  fitLongEdge,
  laplacianVariance,
  meanBrightness,
  toGrayscale,
  type PixelBuffer,
} from "../src/lib/capture/quality";

/** An RGBA image where every pixel is `shade(x, y)` gray, fully opaque. */
function image(
  width: number,
  height: number,
  shade: (x: number, y: number) => number,
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const value = shade(x, y);
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Black and white stripes 2 px wide on a bright page: what sharp text looks like to a Laplacian. */
const sharp = (x: number): number => (Math.floor(x / 2) % 2 === 0 ? 235 : 60);
/** The same page after a heavy blur: a gentle ramp. */
const blurred = (x: number): number => 140 + Math.round(x / 8);

describe("toGrayscale", () => {
  it("weights green most and treats transparent pixels as white paper", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0,
    ]);
    const gray = toGrayscale({ data: rgba, width: 4, height: 1 });
    expect(Array.from(gray)).toEqual([76, 150, 29, 255]);
  });
});

describe("meanBrightness", () => {
  it("is the average gray level", () => {
    expect(meanBrightness(new Uint8Array([0, 100, 200]))).toBe(100);
    expect(meanBrightness(new Uint8Array([]))).toBe(0);
  });
});

describe("laplacianVariance", () => {
  it("is high for crisp edges and near zero for a smooth ramp or a flat frame", () => {
    const crisp = image(64, 64, sharp);
    const soft = image(64, 64, blurred);
    const flat = image(64, 64, () => 128);
    const variance = (px: PixelBuffer) => laplacianVariance(toGrayscale(px), px.width, px.height);
    expect(variance(crisp)).toBeGreaterThan(QUALITY_THRESHOLDS.minLaplacianVariance * 10);
    expect(variance(soft)).toBeLessThan(QUALITY_THRESHOLDS.minLaplacianVariance);
    expect(variance(flat)).toBe(0);
  });

  it("returns 0 for images too small to have an interior", () => {
    expect(laplacianVariance(new Uint8Array(4), 2, 2)).toBe(0);
  });
});

describe("assessQuality", () => {
  it("passes a sharp, well exposed, large photo", () => {
    expect(assessQuality(2048, image(64, 64, sharp))).toEqual([]);
  });

  it("flags a blurry photo", () => {
    expect(assessQuality(2048, image(64, 64, blurred))).toEqual(["blurry"]);
  });

  it("flags a small photo as low_res, only below 1000 px on the long edge", () => {
    expect(assessQuality(999, image(64, 64, sharp))).toEqual(["low_res"]);
    expect(assessQuality(1000, image(64, 64, sharp))).toEqual([]);
  });

  it("flags a dark frame without also calling it blurry", () => {
    const dark = QUALITY_THRESHOLDS.darkMean - 1;
    expect(
      assessQuality(
        2048,
        image(64, 64, () => dark),
      ),
    ).toEqual(["dark"]);
    expect(
      assessQuality(
        2048,
        image(64, 64, () => QUALITY_THRESHOLDS.darkMean),
      ),
    ).not.toContain("dark");
  });

  it("calls a featureless blown-out frame unclear (blurry): there is nothing to read in it", () => {
    expect(
      assessQuality(
        2048,
        image(64, 64, () => 250),
      ),
    ).toEqual(["blurry"]);
  });

  it("accepts a clean white page with dark text (a PDF page, a screenshot, a well-lit sheet)", () => {
    // Mean ~226, about 11% ink: bright on average, and exactly what we want.
    const page = image(64, 64, (x, y) => (y % 16 < 1 || (x % 8 < 1 && y % 8 < 4) ? 30 : 250));
    expect(meanBrightness(toGrayscale(page))).toBeGreaterThan(QUALITY_THRESHOLDS.brightMean);
    expect(assessQuality(2048, page)).toEqual([]);
  });

  it("flags a washed-out page whose text has no ink left", () => {
    expect(
      assessQuality(
        2048,
        image(64, 64, (x) => (x % 4 < 2 ? 250 : 215)),
      ),
    ).toEqual(["bright"]);
  });

  it("reports several problems at once", () => {
    expect(
      assessQuality(
        500,
        image(64, 64, () => 10),
      ),
    ).toEqual(["low_res", "dark"]);
  });
});

describe("fitLongEdge", () => {
  it("shrinks the long edge to the limit and keeps the ratio", () => {
    expect(fitLongEdge(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitLongEdge(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  it("never enlarges", () => {
    expect(fitLongEdge(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
});
