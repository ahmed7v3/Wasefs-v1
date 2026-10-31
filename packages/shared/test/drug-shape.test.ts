import { describe, expect, it } from "vitest";

import {
  SHAPE_MIN_SIMILARITY,
  consonantSkeleton,
  isShapePoolKey,
  levenshtein,
  shapeSimilarity,
} from "../src/drug-shape.js";

describe("consonantSkeleton", () => {
  it("keeps the consonants in order", () => {
    expect(consonantSkeleton("bepra")).toBe("bpr");
    expect(consonantSkeleton("motidyl")).toBe("mtdl");
    expect(consonantSkeleton("Riopan")).toBe("rpn");
  });
});

describe("levenshtein", () => {
  it("counts one edit per insertion, deletion or substitution", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
});

describe("shapeSimilarity (the real-case spellings of T1)", () => {
  it.each([
    ["ripan", "riopan"], // a missing letter
    ["bebra", "bepra"], // b for p
    ["glbimet", "glibimet"], // a missing vowel
    ["motdyl", "motidyl"], // a missing vowel and y
  ])("%s is a shape match for %s", (reading, brand) => {
    expect(shapeSimilarity(reading, brand)).toBeGreaterThanOrEqual(SHAPE_MIN_SIMILARITY);
  });

  it("an unrelated name is not a shape match", () => {
    expect(shapeSimilarity("zorvanex", "riopan")).toBeLessThan(SHAPE_MIN_SIMILARITY);
  });
});

describe("isShapePoolKey", () => {
  it("needs the same first two letters and a length within two", () => {
    expect(isShapePoolKey("ripan", "riopan")).toBe(true);
    expect(isShapePoolKey("ripan", "dostinex")).toBe(false);
    expect(isShapePoolKey("ripan", "ri")).toBe(false);
    expect(isShapePoolKey("rip", "riopanxyz")).toBe(false);
    expect(isShapePoolKey("ri", "ri")).toBe(false);
  });
});
