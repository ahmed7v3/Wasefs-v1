import { describe, expect, it } from "vitest";

import { decideMatch, type DecisionInput, type RankedCandidate } from "../src/drug-decision.js";

const settings = { acceptScore: 0.85, reviewScore: 0.5, minMargin: 0.06 };

let counter = 0;
const candidate = (
  over: Partial<Omit<RankedCandidate, "explanation">> & {
    matchedOn?: RankedCandidate["explanation"]["matchedOn"];
    strength?: RankedCandidate["explanation"]["strength"];
  },
): RankedCandidate => {
  const { matchedOn, strength, ...rest } = over;
  counter += 1;
  return {
    drugId: `drug-${counter}`,
    brandEn: "Brand",
    brandAr: null,
    form: null,
    strengthText: null,
    manufacturer: null,
    status: "active",
    brandKey: `family-${counter}`,
    score: 0.95,
    via: "primary",
    explanation: {
      nameScore: 0.95,
      matchedOn: matchedOn ?? "brand",
      strength: strength ?? "unknown",
      form: "unknown",
    },
    ...rest,
  };
};

const input = (
  candidates: RankedCandidate[],
  over: Partial<Omit<DecisionInput, "candidates">> = {},
): DecisionInput => ({ candidates, legibility: "clear", strengthWritten: false, ...over });

describe("decideMatch", () => {
  it("has nothing to decide without candidates", () => {
    expect(decideMatch(input([]), settings)).toEqual({
      matchClass: "unmatched",
      chosen: null,
      familyOnly: false,
      reason: "no_candidates",
    });
  });

  it("is unmatched below the review score", () => {
    const result = decideMatch(input([candidate({ score: 0.49 })]), settings);
    expect(result).toMatchObject({ matchClass: "unmatched", chosen: null, reason: "below_review" });
  });

  it("accepts a clear, primary, well-separated top", () => {
    const top = candidate({ score: 0.95 });
    const result = decideMatch(input([candidate({ score: 0.7 }), top]), settings);
    expect(result).toEqual({
      matchClass: "accept",
      chosen: top,
      familyOnly: false,
      reason: "accepted",
    });
  });

  it("sends a score between review and accept to verification", () => {
    const result = decideMatch(input([candidate({ score: 0.84 })]), settings);
    expect(result).toMatchObject({ matchClass: "verify", chosen: null, reason: "below_accept" });
  });

  it("reads the thresholds from the settings", () => {
    const only = [candidate({ score: 0.9 })];
    expect(decideMatch(input(only), { ...settings, acceptScore: 0.95 }).reason).toBe(
      "below_accept",
    );
    expect(decideMatch(input(only), { ...settings, acceptScore: 0.9 }).matchClass).toBe("accept");
    expect(
      decideMatch(input(only), { ...settings, reviewScore: 0.91, acceptScore: 0.99 }).reason,
    ).toBe("below_review");
    expect(decideMatch(input(only), { ...settings, minMargin: 0.91 }).reason).toBe(
      "ambiguous_family",
    );
    expect(decideMatch(input(only), { ...settings, minMargin: 0.9 }).reason).toBe("accepted");
  });

  it("verifies a strength conflict", () => {
    const result = decideMatch(input([candidate({ strength: "conflict" })]), settings);
    expect(result).toMatchObject({ matchClass: "verify", reason: "strength_conflict" });
  });

  it("verifies an ingredient-only hit", () => {
    const result = decideMatch(input([candidate({ matchedOn: "ingredient" })]), settings);
    expect(result).toMatchObject({ matchClass: "verify", reason: "ingredient_only" });
  });

  it("verifies a hit found only through a guessed spelling of an Arabic name", () => {
    expect(decideMatch(input([candidate({ transliterated: true })]), settings)).toMatchObject({
      matchClass: "verify",
      reason: "via_alternative",
    });
  });

  it("verifies a hit that came from an alternative or the raw line", () => {
    expect(decideMatch(input([candidate({ via: "alternative" })]), settings).reason).toBe(
      "via_alternative",
    );
    expect(decideMatch(input([candidate({ via: "raw" })]), settings)).toMatchObject({
      matchClass: "verify",
      reason: "via_alternative",
    });
  });

  it("verifies unclear handwriting but accepts partial", () => {
    const only = [candidate({})];
    expect(decideMatch(input(only, { legibility: "unclear" }), settings)).toMatchObject({
      matchClass: "verify",
      reason: "unclear_handwriting",
    });
    expect(decideMatch(input(only, { legibility: "partial" }), settings).matchClass).toBe("accept");
  });

  describe("margin against other brand families", () => {
    it("verifies when another family is within the margin", () => {
      const result = decideMatch(
        input([candidate({ score: 0.95 }), candidate({ score: 0.91 })]),
        settings,
      );
      expect(result).toMatchObject({
        matchClass: "verify",
        chosen: null,
        reason: "ambiguous_family",
      });
    });

    it("accepts when the gap is clearly more than the margin", () => {
      const result = decideMatch(
        input([candidate({ score: 0.96 }), candidate({ score: 0.88 })]),
        settings,
      );
      expect(result.matchClass).toBe("accept");
    });

    it("lets a zero margin accept a tie", () => {
      const result = decideMatch(input([candidate({ score: 0.95 }), candidate({ score: 0.95 })]), {
        ...settings,
        minMargin: 0,
      });
      expect(result.matchClass).toBe("accept");
    });

    it("does not count variants of the same family as competitors", () => {
      const a = candidate({ score: 0.95, brandKey: "flumox", strengthText: "250 mg" });
      const b = candidate({ score: 0.94, brandKey: "flumox", strengthText: "500 mg" });
      const result = decideMatch(input([a, b], { strengthWritten: true }), settings);
      expect(result).toMatchObject({ matchClass: "accept", chosen: a, familyOnly: false });
    });

    it("treats an empty brand key as no family", () => {
      const a = candidate({ score: 0.95, brandKey: "" });
      const b = candidate({ score: 0.94, brandKey: "" });
      expect(decideMatch(input([a, b]), settings).reason).toBe("ambiguous_family");
    });

    it("still compares against another family behind the variants", () => {
      const a = candidate({ score: 0.95, brandKey: "flumox" });
      const b = candidate({ score: 0.94, brandKey: "flumox" });
      const other = candidate({ score: 0.92, brandKey: "flumoxin" });
      expect(decideMatch(input([a, b, other]), settings).reason).toBe("ambiguous_family");
    });
  });

  describe("family only", () => {
    const variants = (): RankedCandidate[] => [
      candidate({ score: 0.95, brandKey: "flumox", strengthText: "250 mg" }),
      candidate({ score: 0.95, brandKey: "flumox", strengthText: "500 mg" }),
    ];

    it("accepts the family without strength when none was written", () => {
      const result = decideMatch(input(variants()), settings);
      expect(result).toMatchObject({ matchClass: "accept", familyOnly: true, reason: "accepted" });
      expect(result.chosen?.brandKey).toBe("flumox");
    });

    it("is not family-only when a strength was written", () => {
      const result = decideMatch(input(variants(), { strengthWritten: true }), settings);
      expect(result.familyOnly).toBe(false);
    });

    it("is not family-only when the variants share one strength", () => {
      const same = [
        candidate({ score: 0.95, brandKey: "k", strengthText: "500 mg" }),
        candidate({ score: 0.95, brandKey: "k", strengthText: "500 mg" }),
      ];
      expect(decideMatch(input(same), settings).familyOnly).toBe(false);
    });

    it("is not family-only for a lone candidate", () => {
      expect(decideMatch(input([candidate({})]), settings).familyOnly).toBe(false);
    });
  });

  describe("alias_exact", () => {
    it("accepts regardless of margin and legibility", () => {
      const exact = candidate({ score: 1, matchedOn: "alias_exact" });
      const rival = candidate({ score: 0.99 });
      const result = decideMatch(input([rival, exact], { legibility: "unclear" }), settings);
      expect(result).toEqual({
        matchClass: "accept",
        chosen: exact,
        familyOnly: false,
        reason: "alias_exact",
      });
    });

    it("does not override a strength conflict", () => {
      const exact = candidate({ score: 0.9, matchedOn: "alias_exact", strength: "conflict" });
      expect(decideMatch(input([exact]), settings)).toMatchObject({
        matchClass: "verify",
        reason: "strength_conflict",
      });
    });

    it("still needs the review score", () => {
      const exact = candidate({ score: 0.4, matchedOn: "alias_exact" });
      expect(decideMatch(input([exact]), settings).reason).toBe("below_review");
    });
  });

  it("ranks by score whatever the input order", () => {
    const low = candidate({ score: 0.6 });
    const high = candidate({ score: 0.97 });
    expect(decideMatch(input([low, high]), settings).chosen).toBe(high);
  });

  it("does not change its input", () => {
    const list = [candidate({ score: 0.6 }), candidate({ score: 0.97 })];
    const before = list.map((c) => c.drugId);
    decideMatch(input(list), settings);
    expect(list.map((c) => c.drugId)).toEqual(before);
  });
});
