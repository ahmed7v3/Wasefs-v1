import { describe, expect, it } from "vitest";

import {
  damerauDistance,
  nameAgrees,
  trigramSimilarity,
  NAME_AGREE_SIMILARITY,
} from "../src/rx-name-integrity.js";

const product = (brandEn: string, brandKey?: string) => ({
  brandEn,
  brandKey: brandKey ?? brandEn.toLowerCase(),
});

describe("nameAgrees", () => {
  it("rejects a similar-looking brand: Ripanox vs Riopan", () => {
    expect(nameAgrees("Ripanox", product("Riopan"))).toBe(false);
  });

  it("rejects other brands that only share a prefix or an ingredient: Gabimedra", () => {
    for (const other of ["Gabitril", "Gabapentin 300mg caps", "Gabimex", "Gabiplus", "Neurontin"]) {
      expect(nameAgrees("Gabimedra", product(other))).toBe(false);
    }
  });

  it("accepts the same name, with strength and form words ignored", () => {
    expect(nameAgrees("Flatydiel", product("Flatydiel"))).toBe(true);
    expect(nameAgrees("flatydiel", product("Flatydiel 50mg chewable tabs", "flatydiel"))).toBe(
      true,
    );
  });

  it("accepts a brand family: Panadol / Panadol Extra, either way", () => {
    expect(nameAgrees("Panadol", product("Panadol Extra"))).toBe(true);
    expect(nameAgrees("Panadol Extra", product("Panadol"))).toBe(true);
    expect(nameAgrees("Pan", product("Panadol Extra"))).toBe(false);
  });

  it("accepts one wrong, missing or swapped letter in a name of 5+ letters", () => {
    expect(nameAgrees("Panadoll", product("Panadol"))).toBe(true);
    expect(nameAgrees("Ripan", product("Riopan"))).toBe(true);
    expect(nameAgrees("Pandaol", product("Panadol"))).toBe(true);
    // two letters, or a name too short for a typo allowance
    expect(nameAgrees("Panadxx", product("Panadol"))).toBe(false);
    expect(nameAgrees("Zyro", product("Zyra"))).toBe(false);
  });

  it("compares Arabic brand names too", () => {
    expect(nameAgrees("بنادول", { brandEn: "Panadol", brandAr: "بنادول" })).toBe(true);
    expect(nameAgrees("بنادول", { brandEn: "Panadol", brandAr: null })).toBe(false);
  });

  it("does not agree on empty text", () => {
    expect(nameAgrees("", product("Panadol"))).toBe(false);
  });
});

describe("similarity helpers", () => {
  it("trigramSimilarity follows pg_trgm", () => {
    expect(trigramSimilarity("word", "word")).toBe(1);
    expect(trigramSimilarity("", "word")).toBe(0);
    // pg_trgm: similarity('word','two words') = 0.36363636
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.3636, 3);
    expect(NAME_AGREE_SIMILARITY).toBe(0.8);
  });

  it("damerauDistance counts a neighbour swap as one edit", () => {
    expect(damerauDistance("panadol", "pandaol")).toBe(1);
    expect(damerauDistance("ripan", "riopan")).toBe(1);
    expect(damerauDistance("ripanox", "riopan")).toBe(3);
    expect(damerauDistance("", "ab")).toBe(2);
  });
});
