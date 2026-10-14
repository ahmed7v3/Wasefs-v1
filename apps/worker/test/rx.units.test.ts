import { describe, expect, it } from "vitest";

import { cropRect } from "../src/rx/crop.js";
import { markSkipped, pickForVerification, type WorkItem } from "../src/rx/pipeline.js";

describe("cropRect", () => {
  it("pads the box by 15 percent on every side", () => {
    // A 200 x 100 px box in a 1000 x 1000 px image, centred.
    expect(cropRect([450, 400, 550, 600], 1000, 1000)).toEqual({
      left: 370,
      top: 435,
      width: 260,
      height: 130,
    });
  });

  it("stays inside the image", () => {
    const rect = cropRect([0, 0, 100, 100], 500, 500);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
    const edge = cropRect([900, 900, 1000, 1000], 500, 500);
    expect(edge.left + edge.width).toBeLessThanOrEqual(500);
    expect(edge.top + edge.height).toBeLessThanOrEqual(500);
  });

  it("never returns a sliver too small to read", () => {
    const rect = cropRect([500, 500, 501, 501], 2000, 2000);
    expect(rect.width).toBeGreaterThanOrEqual(48);
    expect(rect.height).toBeGreaterThanOrEqual(48);
  });
});

const work = (
  flagged: boolean,
  confidence: number,
  matchClass: WorkItem["matchClass"] = "accept",
): WorkItem =>
  ({
    extracted: { confidence },
    candidates: [],
    matchClass,
    chosen: null,
    flagged,
    verified: "not_needed",
    verifyCeiling: undefined,
    nameOverride: null,
  }) as unknown as WorkItem;

describe("verification selection", () => {
  it("picks only flagged lines, the riskiest first, at most the cap", () => {
    const items = [
      work(false, 0.3),
      work(true, 0.7),
      work(true, 0.2),
      work(true, 0.5, "verify"),
      work(true, 0.6),
    ];
    expect(pickForVerification(items, 3)).toEqual([3, 2, 4]);
    expect(pickForVerification(items, 0)).toEqual([]);
  });

  it("marks flagged lines that were left out as skipped, with a ceiling", () => {
    const items = [work(true, 0.5), work(true, 0.4), work(false, 0.9)];
    markSkipped(items, new Set([0]));
    expect(items.map((item) => item.verified)).toEqual(["not_needed", "skipped", "not_needed"]);
    expect(items[1]?.verifyCeiling).toBeLessThanOrEqual(0.84);
  });
});
