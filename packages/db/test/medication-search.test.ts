import { describe, expect, it } from "vitest";

import { medicationCardsFor, medicationNgrams } from "../src/medication-search.js";

import type { Database } from "../src/client.js";

/* The pure part of the reference cards: which names a message is looked up by. The queries are in medication-search.int.test.ts. */

describe("medicationNgrams", () => {
  it("builds 1-3-word grams in order of first appearance, normalized", () => {
    expect(medicationNgrams("Flumox safe for kids")).toEqual([
      "flumox",
      "flumox safe",
      "flumox safe for",
      "safe",
      "safe for",
      "safe for kids",
      "for",
      "for kids",
      "kids",
    ]);
  });

  it("splits on punctuation and Arabic text alike", () => {
    const grams = medicationNgrams("هل بنادول، آمن؟");
    expect(grams).toContain("بنادول");
    expect(grams.every((gram) => !/[،؟]/.test(gram))).toBe(true);
  });

  it("drops grams of fewer than 3 characters and duplicates", () => {
    const grams = medicationNgrams("a a panadol panadol");
    expect(grams).not.toContain("a");
    expect(grams.filter((gram) => gram === "panadol")).toHaveLength(1);
  });

  it("caps the number of grams", () => {
    const text = Array.from({ length: 200 }, (_, i) => `drug${String(i)}`).join(" ");
    expect(medicationNgrams(text).length).toBeLessThanOrEqual(60);
  });

  it("is empty for text without a name", () => {
    expect(medicationNgrams("  ?! ")).toEqual([]);
  });
});

describe("medicationCardsFor", () => {
  it("does not touch the database when nothing is asked for", async () => {
    const db = {
      execute: () => Promise.reject(new Error("must not be called")),
    } as unknown as Database;
    expect(await medicationCardsFor(db, "panadol", 0)).toEqual([]);
    expect(await medicationCardsFor(db, "  ?! ", 3)).toEqual([]);
  });
});
