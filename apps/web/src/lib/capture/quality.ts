import type { QualityIssue } from "@wasfa/ui";

/*
 * Client-side quality check of a prescription photo (Task 2.6). Pure functions on raw pixel
 * arrays, so they run in a Worker, on the main thread, or in a unit test with synthetic images.
 * Nothing here touches the network: a bad photo costs nothing, the person just gets a hint.
 */

/**
 * The limits. They are first guesses, NOT tuned yet: the owner tunes them on the eval images and
 * records the result in phase2.md Notes (Task 2.6). The blur one in particular depends on the
 * Laplacian kernel and the 512 px copy used below, so change them together.
 */
export const QUALITY_THRESHOLDS = {
  /** A long edge under this many pixels is too small to read handwriting. */
  minLongEdge: 1000,
  /** Variance of the Laplacian of the grayscale copy under this = blurry. UNTUNED. */
  minLaplacianVariance: 100,
  /** Mean brightness (0-255) under this = too dark. */
  darkMean: 50,
  /**
   * Mean brightness (0-255) over this = washed out or glare, but only when the page also has
   * (almost) no ink: a clean white page with dark text is also very bright on average (a PDF page,
   * a screenshot, a well-lit sheet) and is exactly what we want. Found in the first end-to-end run.
   */
  brightMean: 215,
  /** A pixel darker than this counts as ink. */
  inkLevel: 100,
  /** Less ink than this share of the pixels, on a bright page, = the text is washed out. */
  minInkFraction: 0.003,
} as const;

/** Edge of the grayscale copy the blur and exposure checks look at. */
export const QUALITY_SAMPLE_EDGE = 512;

export interface PixelBuffer {
  /** RGBA, 4 bytes per pixel, row by row (what `getImageData().data` gives). */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Rec. 601 luma, one byte per pixel. Transparent pixels count as white paper. */
export function toGrayscale({ data, width, height }: PixelBuffer): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const at = pixel * 4;
    const alpha = (data[at + 3] ?? 255) / 255;
    const red = (data[at] ?? 0) * alpha + 255 * (1 - alpha);
    const green = (data[at + 1] ?? 0) * alpha + 255 * (1 - alpha);
    const blue = (data[at + 2] ?? 0) * alpha + 255 * (1 - alpha);
    gray[pixel] = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
  }
  return gray;
}

/** Share of pixels darker than `level`: the text of a document. */
export function inkFraction(gray: Uint8Array, level: number): number {
  if (gray.length === 0) return 0;
  let ink = 0;
  for (const value of gray) if (value < level) ink += 1;
  return ink / gray.length;
}

export function meanBrightness(gray: Uint8Array): number {
  if (gray.length === 0) return 0;
  let sum = 0;
  for (const value of gray) sum += value;
  return sum / gray.length;
}

/**
 * Variance of the 4-neighbour Laplacian over the interior pixels: sharp text has strong edges so
 * the response varies a lot, a blurred photo is smooth so it barely varies.
 */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const response =
        (gray[at - width] ?? 0) +
        (gray[at + width] ?? 0) +
        (gray[at - 1] ?? 0) +
        (gray[at + 1] ?? 0) -
        4 * (gray[at] ?? 0);
      sum += response;
      sumSquares += response * response;
      count += 1;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Size that keeps the aspect ratio with the long edge at most `edge`; never enlarges. */
export function fitLongEdge(
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= edge) return { width, height };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Which problems a photo has. `longEdge` is the size of the image that will be uploaded;
 * `sample` is a downscaled RGBA copy of it (long edge `QUALITY_SAMPLE_EDGE`).
 */
export function assessQuality(longEdge: number, sample: PixelBuffer): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (longEdge < QUALITY_THRESHOLDS.minLongEdge) issues.push("low_res");

  const gray = toGrayscale(sample);
  const mean = meanBrightness(gray);
  const dark = mean < QUALITY_THRESHOLDS.darkMean;
  if (dark) issues.push("dark");

  // A very dark frame is flat as well; saying "blurry" on top of it only confuses.
  const blurry =
    !dark &&
    laplacianVariance(gray, sample.width, sample.height) < QUALITY_THRESHOLDS.minLaplacianVariance;
  if (blurry) issues.push("blurry");
  // A blur also wipes out the ink, so "too bright" is reported only for a sharp page without ink.
  else if (
    mean > QUALITY_THRESHOLDS.brightMean &&
    inkFraction(gray, QUALITY_THRESHOLDS.inkLevel) < QUALITY_THRESHOLDS.minInkFraction
  ) {
    issues.push("bright");
  }
  return issues;
}
