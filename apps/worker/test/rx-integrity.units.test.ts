import { rxExtractionSchema, type RxExtraction } from "@wasfa/shared/schemas/rx";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyVerification,
  buildResult,
  matchItems,
  matchLine,
  reconcileForm,
  type RecognitionSettings,
} from "../src/rx/pipeline.js";

import type { Database } from "@wasfa/db";
import type { RankedCandidate } from "@wasfa/shared/drug-decision";

/*
 * Name integrity and form consistency (production hotfix): a database brand that merely resembles the
 * written name is a "did you mean", never the name; the form shown agrees with the paper and directions.
 */

const { matchDrug, shapeCandidates } = vi.hoisted(() => ({
  matchDrug: vi.fn(),
  shapeCandidates: vi.fn(),
}));
vi.mock("@wasfa/db", () => ({ matchDrug, shapeCandidates }));

const settings: RecognitionSettings = {
  similarityFloor: 0.3,
  acceptScore: 0.85,
  reviewScore: 0.5,
  minMargin: 0.06,
  strengthBonus: 0.1,
  strengthConflictPenalty: 0.15,
  formBonus: 0.05,
  maxCandidates: 5,
  useAlternatives: true,
};
const db = {} as Database;

const id = (n: number): string => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const cand = (
  n: number,
  brandEn: string,
  score: number,
  over: Partial<RankedCandidate> = {},
): Omit<RankedCandidate, "via"> => ({
  drugId: id(n),
  brandEn,
  brandAr: null,
  brandKey: brandEn.toLowerCase(),
  form: "tablet",
  strengthText: null,
  manufacturer: null,
  status: "active",
  score,
  explanation: { nameScore: score, matchedOn: "brand", strength: "unknown", form: "unknown" },
  ...over,
});

const line = (over: Partial<RxExtraction["items"][number]> = {}) =>
  rxExtractionSchema.shape.items.element.parse({
    rawText: "Flatydiel 1x2",
    name: "Flatydiel",
    activeIngredient: null,
    strength: null,
    form: null,
    dose: null,
    frequency: null,
    duration: null,
    route: null,
    notes: null,
    alternatives: [],
    legibility: "clear",
    confidence: 0.95,
    box_2d: null,
    page: 0,
    ...over,
  });

const extractionOf = (items: RxExtraction["items"]): RxExtraction =>
  rxExtractionSchema.parse({
    items,
    prescriberLegible: true,
    date: null,
    unreadableRegions: [],
  });

const script = (byText: Record<string, Omit<RankedCandidate, "via">[]>): void => {
  matchDrug.mockImplementation((_db: unknown, text: string) => Promise.resolve(byText[text] ?? []));
};

beforeEach(() => {
  matchDrug.mockReset();
  shapeCandidates.mockReset();
  shapeCandidates.mockResolvedValue([]);
});

describe("name integrity", () => {
  it("(c) offers Riopan for Ripanox but keeps the written name, uncertain", async () => {
    const riopan = cand(1, "Riopan", 0.92);
    script({ Ripanox: [riopan] });
    const extraction = extractionOf([line({ rawText: "Ripanox", name: "Ripanox" })]);
    const items = await matchItems(db, extraction, settings);
    expect(items[0]).toMatchObject({ chosen: null, matchClass: "verify", flagged: true });

    // The verification is sure it is Riopan: still not shown as the written name.
    await applyVerification(
      db,
      items,
      new Map([[0, items[0]?.candidates ?? []]]),
      { answers: [{ index: 0, kind: "candidate", id: id(1), confidence: 0.95 }] },
      settings,
    );
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({
      name: "Ripanox",
      source: "ai",
      match: "ai",
      matchedDrugId: null,
      suggestion: { drugId: id(1), name: "Riopan" },
      suggestions: [{ drugId: id(1), name: "Riopan" }],
    });
  });

  it("(b) offers a same-ingredient brand for Gabimedra but keeps the written name", async () => {
    script({
      Gabimedra: [
        cand(2, "Gabirex", 0.9, {
          explanation: {
            nameScore: 0.4,
            matchedOn: "ingredient",
            strength: "unknown",
            form: "unknown",
          },
        }),
        cand(3, "Gabiplus", 0.88),
      ],
    });
    const extraction = extractionOf([line({ rawText: "Gabimedra", name: "Gabimedra" })]);
    const items = await matchItems(db, extraction, settings);
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({ name: "Gabimedra", source: "ai", matchedDrugId: null });
    expect(result.items[0]?.suggestions?.map((s) => s.name)).toEqual(["Gabirex", "Gabiplus"]);
  });

  it("offers at most 3 products, one per brand family", async () => {
    script({
      Gabimedra: [1, 2, 3, 4].map((n) => cand(n, `Gabi${n}x`, 0.9 - n / 100)),
    });
    const extraction = extractionOf([line({ rawText: "Gabimedra", name: "Gabimedra" })]);
    const items = await matchItems(db, extraction, settings);
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]?.suggestions).toHaveLength(3);
  });

  it("does not offer products after the model said none of them", async () => {
    script({ Gabimedra: [cand(2, "Gabirex", 0.9)] });
    const extraction = extractionOf([line({ rawText: "Gabimedra", name: "Gabimedra" })]);
    const items = await matchItems(db, extraction, settings);
    await applyVerification(
      db,
      items,
      new Map([[0, items[0]?.candidates ?? []]]),
      { answers: [{ index: 0, kind: "none" }] },
      settings,
    );
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({ name: "Gabimedra", suggestion: null });
    expect(result.items[0]?.suggestions).toBeUndefined();
  });

  it("does not accept a verification re-read as a similar-looking brand", async () => {
    script({ Riopan: [cand(1, "Riopan", 0.97)], Ripanox: [cand(1, "Riopan", 0.97)] });
    const out = await matchLine(
      db,
      line({ rawText: "Ripanox", name: "Ripanox" }),
      settings,
      "Ripanox",
    );
    expect(out.decision).toMatchObject({ matchClass: "verify", chosen: null });
    const agreeing = await matchLine(db, line({ name: "Riopan" }), settings, "Riopan");
    expect(agreeing.decision.chosen?.brandEn).toBe("Riopan");
  });

  it("still shows the database name for a one-letter difference (Ripan / Riopan)", async () => {
    script({ Ripan: [cand(1, "Riopan", 0.9)] });
    const out = await matchLine(db, line({ rawText: "Ripan", name: "Ripan" }), settings);
    expect(out.decision).toMatchObject({ matchClass: "accept" });
    expect(out.decision.chosen?.brandEn).toBe("Riopan");
  });

  it("never accepts a product whose written strength conflicts", async () => {
    script({
      Flatydiel: [
        cand(1, "Flatydiel", 0.97, {
          explanation: {
            nameScore: 0.97,
            matchedOn: "brand",
            strength: "conflict",
            form: "unknown",
          },
        }),
      ],
    });
    const out = await matchLine(db, line({ strength: "999 mg" }), settings);
    expect(out.decision.chosen).toBeNull();
  });
});

describe("form consistency", () => {
  const flatydielVariants = (): Record<string, Omit<RankedCandidate, "via">[]> => ({
    Flatydiel: [
      cand(10, "Flatydiel", 0.97, { form: "drops", brandKey: "flatydiel" }),
      cand(11, "Flatydiel", 0.96, { form: "chewable tablet", brandKey: "flatydiel" }),
    ],
  });

  it("(a) picks the chewable variant when the directions say chew, never drops", async () => {
    script(flatydielVariants());
    const extraction = extractionOf([line({ dose: "قرص مضغ", frequency: "مرتين يوميا" })]);
    const items = await matchItems(db, extraction, settings);
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({
      name: "Flatydiel",
      matchedDrugId: id(11),
      form: "chewable tablet",
    });
    expect(result.items[0]?.formConflict).toBeUndefined();
  });

  it("prefers the written form over the directions when choosing the variant", async () => {
    script(flatydielVariants());
    const extraction = extractionOf([line({ form: "drops", dose: "5 drops" })]);
    const items = await matchItems(db, extraction, settings);
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({ matchedDrugId: id(10), form: "drops" });
  });

  it("shows the directions form and flags the line when only a contradicting variant exists", async () => {
    script({ Flatydiel: [cand(10, "Flatydiel", 0.97, { form: "drops", brandKey: "flatydiel" })] });
    const extraction = extractionOf([line({ dose: "قرص مضغ" })]);
    const items = await matchItems(db, extraction, settings);
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({ form: "chewable tablet", formConflict: true });
    expect(result.items[0]?.badge).not.toBe("high");
  });

  it("a variant that matches the written strength still wins over a better form fit", async () => {
    script({
      Flatydiel: [
        cand(10, "Flatydiel", 0.9, {
          form: "chewable tablet",
          brandKey: "flatydiel",
          strengthText: "50 mg",
          explanation: {
            nameScore: 0.9,
            matchedOn: "brand",
            strength: "conflict",
            form: "unknown",
          },
        }),
        cand(11, "Flatydiel", 0.97, {
          form: "tablet",
          brandKey: "flatydiel",
          strengthText: "100 mg",
          explanation: { nameScore: 0.97, matchedOn: "brand", strength: "match", form: "unknown" },
        }),
      ],
    });
    const extraction = extractionOf([line({ strength: "100 mg", dose: "قرص مضغ" })]);
    const items = await matchItems(db, extraction, settings);
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]?.matchedDrugId).toBe(id(11));
  });
});

describe("reconcileForm", () => {
  it("the written form wins; the database spelling is used for the same form", () => {
    expect(reconcileForm("tab", "", "tablet")).toEqual({ form: "tablet", conflict: false });
    expect(reconcileForm("syrup", "", null)).toEqual({ form: "syrup", conflict: false });
  });

  it("falls back to the directions, then to the product", () => {
    expect(reconcileForm(null, "قرص مضغ", null)).toEqual({
      form: "chewable tablet",
      conflict: false,
    });
    expect(reconcileForm(null, "", "capsule")).toEqual({ form: "capsule", conflict: false });
    expect(reconcileForm(null, "قرص", "chewable tablet")).toEqual({
      form: "chewable tablet",
      conflict: false,
    });
  });

  it("flags a product from the other oral group instead of showing it", () => {
    expect(reconcileForm("chewable", "", "drops")).toEqual({ form: "chewable", conflict: true });
    expect(reconcileForm(null, "5 ml", "tablet")).toEqual({ form: null, conflict: true });
  });

  it("does not call injectables or topicals a conflict", () => {
    expect(reconcileForm(null, "قرص", "cream")).toEqual({ form: "tablet", conflict: false });
  });
});
