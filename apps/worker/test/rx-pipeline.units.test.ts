import { rxExtractionSchema, type RxExtraction } from "@wasfa/shared/schemas/rx";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyVerification,
  buildResult,
  matchItems,
  matchLine,
  unmatchedReadings,
  type RecognitionSettings,
  type WorkItem,
} from "../src/rx/pipeline.js";

import type { Database } from "@wasfa/db";
import type { RankedCandidate } from "@wasfa/shared/drug-decision";

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

const cand = (
  id: string,
  score: number,
  over: Partial<RankedCandidate> = {},
): Omit<RankedCandidate, "via"> => ({
  drugId: id,
  brandEn: `Brand ${id}`,
  brandAr: null,
  brandKey: `key-${id}`,
  form: "tablet",
  strengthText: "500 mg",
  manufacturer: null,
  status: "active",
  score,
  explanation: { nameScore: score, matchedOn: "brand", strength: "unknown", form: "unknown" },
  ...over,
});

const line = (
  over: Partial<RxExtraction["items"][number]> = {},
): RxExtraction["items"][number] => ({
  rawText: "Dostenix 1x2",
  name: "Dostenix",
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

/** Scripts `matchDrug` by the text it is asked about. */
const script = (byText: Record<string, Omit<RankedCandidate, "via">[]>): void => {
  matchDrug.mockImplementation((_db: unknown, text: string) => Promise.resolve(byText[text] ?? []));
};

beforeEach(() => {
  matchDrug.mockReset();
  shapeCandidates.mockReset();
  shapeCandidates.mockResolvedValue([]);
});

describe("matchLine", () => {
  it("accepts a clear primary reading that clears the margin", async () => {
    script({ Dostenix: [cand("a", 0.97), cand("b", 0.6)] });
    const out = await matchLine(db, line(), settings);
    expect(out.decision).toMatchObject({ matchClass: "accept", reason: "accepted" });
    expect(out.candidates.map((c) => c.via)).toEqual(["primary", "primary"]);
  });

  it("passes the settings to the matcher", async () => {
    script({});
    await matchLine(db, line({ strength: "500 mg", form: "tablet" }), {
      ...settings,
      similarityFloor: 0.4,
      maxCandidates: 3,
    });
    expect(matchDrug).toHaveBeenCalledWith(
      db,
      "Dostenix",
      expect.objectContaining({ similarityFloor: 0.4, limit: 3, formBonus: 0.05, form: "tablet" }),
    );
  });

  it("merges alternatives and the raw line by drug, keeping the best score and its origin", async () => {
    script({
      Dostenix: [cand("a", 0.55)],
      Dostinex: [cand("a", 0.98), cand("b", 0.4)],
      "Dostenix 1x2": [cand("c", 0.6)],
    });
    const out = await matchLine(db, line({ alternatives: ["Dostinex"] }), settings);
    expect(out.candidates.map((c) => [c.drugId, c.score, c.via])).toEqual([
      ["a", 0.98, "alternative"],
      ["c", 0.6, "raw"],
      ["b", 0.4, "alternative"],
    ]);
    // The best hit came from an alternative reading: never accepted on its own.
    expect(out.decision).toMatchObject({ matchClass: "verify", reason: "via_alternative" });
  });

  it("keeps the primary origin when the primary hit is the best", async () => {
    script({ Dostenix: [cand("a", 0.97)], Dostinex: [cand("a", 0.9)] });
    const out = await matchLine(db, line({ alternatives: ["Dostinex"] }), settings);
    expect(out.candidates[0]?.via).toBe("primary");
    expect(out.decision.matchClass).toBe("accept");
  });

  it("ignores alternatives when they are switched off, but still falls back to the raw line", async () => {
    script({ Dostinex: [cand("a", 0.99)], "Dostenix 1x2": [cand("c", 0.7)] });
    const out = await matchLine(db, line({ alternatives: ["Dostinex"] }), {
      ...settings,
      useAlternatives: false,
    });
    expect(out.candidates.map((c) => c.drugId)).toEqual(["c"]);
    expect(matchDrug).not.toHaveBeenCalledWith(db, "Dostinex", expect.anything());
  });

  it("trims to maxCandidates", async () => {
    script({ Dostenix: [cand("a", 0.9), cand("b", 0.8), cand("c", 0.7)] });
    const out = await matchLine(db, line(), { ...settings, maxCandidates: 2 });
    expect(out.candidates.map((c) => c.drugId)).toEqual(["a", "b"]);
  });

  it("sends unclear handwriting to verification", async () => {
    script({ Dostenix: [cand("a", 0.97)] });
    const out = await matchLine(db, line({ legibility: "unclear" }), settings);
    expect(out.decision).toMatchObject({ matchClass: "verify", reason: "unclear_handwriting" });
  });

  it("matches a verification re-read on its own text and never accepts it as clear", async () => {
    script({ "Re-read": [cand("a", 0.97)] });
    const out = await matchLine(db, line({ legibility: "unclear" }), settings, "Re-read");
    expect(out.decision.matchClass).toBe("accept");
    expect(matchDrug).toHaveBeenCalledTimes(1);
  });
});

describe("matchItems", () => {
  it("flags verify decisions and unclear handwriting", async () => {
    script({ Dostenix: [cand("a", 0.7)], Panadol: [cand("p", 0.99)] });
    const extraction = rxExtractionSchema.parse({
      items: [
        line(),
        line({ rawText: "Panadol", name: "Panadol", legibility: "unclear" }),
        line({ rawText: "Panadol", name: "Panadol" }),
      ],
      prescriberLegible: true,
      date: null,
      unreadableRegions: [],
    });
    const items = await matchItems(db, extraction, settings);
    expect(items.map((item) => [item.matchClass, item.flagged])).toEqual([
      ["verify", true],
      ["verify", true],
      ["accept", false],
    ]);
  });
});

const work = (over: Partial<WorkItem> = {}): WorkItem => ({
  extracted: rxExtractionSchema.shape.items.element.parse(line()),
  candidates: [],
  matchClass: "unmatched",
  chosen: null,
  familyOnly: false,
  flagged: false,
  verified: "not_needed",
  verifyCeiling: undefined,
  nameOverride: null,
  likely: false,
  suggestion: null,
  ...over,
});

const extraction = rxExtractionSchema.parse({
  items: [],
  prescriberLegible: true,
  date: null,
  unreadableRegions: [],
});

const drugId = "0190a000-0000-7000-8000-000000000001";
const ranked = (over: Partial<RankedCandidate> = {}): RankedCandidate => ({
  ...cand(drugId, 0.95),
  via: "primary",
  ...over,
});

describe("buildResult", () => {
  const ingredients = new Map([[drugId, ["Cabergoline"]]]);

  it("takes brand, ingredients, form and strength from the database, the rest from the paper", () => {
    const chosen = ranked({ brandEn: "Dostinex", strengthText: "0.5 mg", form: "tablet" });
    const result = buildResult(
      extraction,
      [
        work({
          chosen,
          matchClass: "accept",
          extracted: rxExtractionSchema.shape.items.element.parse(
            line({ strength: "0,5mg", form: "tab", dose: "1 tab", frequency: "1x2" }),
          ),
        }),
      ],
      ingredients,
    );
    expect(result.items[0]).toMatchObject({
      name: "Dostinex",
      source: "database",
      reading: "Dostenix",
      matchedDrugId: drugId,
      activeIngredients: ["Cabergoline"],
      strength: "0.5 mg",
      form: "tablet",
      dose: "1 tab",
      frequency: "1x2",
    });
  });

  it("keeps the strength of the prescription for a family-only match", () => {
    const chosen = ranked({ strengthText: "250 mg" });
    const withStrength = work({
      chosen,
      familyOnly: true,
      extracted: rxExtractionSchema.shape.items.element.parse(line({ strength: null })),
    });
    expect(buildResult(extraction, [withStrength], ingredients).items[0]?.strength).toBeNull();
  });

  it("keeps the written strength when the database one conflicts, and says so", () => {
    const chosen = ranked({
      strengthText: "250 mg",
      explanation: { nameScore: 0.95, matchedOn: "brand", strength: "conflict", form: "unknown" },
    });
    const result = buildResult(
      extraction,
      [
        work({
          chosen,
          extracted: rxExtractionSchema.shape.items.element.parse(line({ strength: "1000 mg" })),
        }),
      ],
      ingredients,
    );
    expect(result.items[0]?.strength).toBe("1000 mg");
    expect(result.findings).toContainEqual({
      kind: "strength_unknown",
      itemIndexes: [0],
      ingredient: null,
    });
  });

  it("keeps the AI reading of an unmatched line and labels it", () => {
    const result = buildResult(extraction, [work()], ingredients);
    expect(result.items[0]).toMatchObject({
      name: "Dostenix",
      source: "ai",
      matchedDrugId: null,
    });
    expect(result.items[0]?.badge).not.toBe("high");
  });
});

describe("applyVerification", () => {
  const offered = (items: WorkItem[]) => new Map([[0, items[0]?.candidates ?? []]]);

  it("keeps the AI reading when the answer is none of the candidates", async () => {
    const items = [work({ candidates: [ranked()], matchClass: "verify", flagged: true })];
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "none" }] },
      settings,
    );
    expect(items[0]).toMatchObject({
      chosen: null,
      matchClass: "unmatched",
      verified: "confirmed",
      verifyCeiling: 0.6,
    });
    const result = buildResult(extraction, items, new Map());
    expect(result.items[0]).toMatchObject({ source: "ai", name: "Dostenix" });
  });

  it("chooses a candidate that was offered, and only that", async () => {
    const items = [work({ candidates: [ranked()], matchClass: "verify", flagged: true })];
    await applyVerification(
      db,
      items,
      offered(items),
      {
        answers: [
          {
            index: 0,
            kind: "candidate",
            id: "0190a000-0000-7000-8000-0000000000ff",
            confidence: 0.9,
          },
        ],
      },
      settings,
    );
    expect(items[0]).toMatchObject({ chosen: null, verified: "unreadable" });

    const again = [work({ candidates: [ranked()], matchClass: "verify", flagged: true })];
    await applyVerification(
      db,
      again,
      offered(again),
      { answers: [{ index: 0, kind: "candidate", id: drugId, confidence: 0.9 }] },
      settings,
    );
    expect(again[0]?.chosen?.drugId).toBe(drugId);
    expect(again[0]?.verified).toBe("confirmed");
  });

  it("keeps the family-only rule when the model picks one strength of an unwritten family", async () => {
    const a = ranked({ drugId: "a", brandKey: "flumox", strengthText: "250 mg" });
    const b = ranked({ drugId: "b", brandKey: "flumox", strengthText: "500 mg" });
    const items = [work({ candidates: [a, b], matchClass: "verify", flagged: true })];
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "candidate", id: "a", confidence: 0.9 }] },
      settings,
    );
    expect(items[0]?.familyOnly).toBe(true);
  });
});

describe("unmatchedReadings", () => {
  it("lists unmatched, readable lines by normalized name", () => {
    const items = [
      work(),
      work({ chosen: ranked(), matchClass: "accept" }),
      work({ verified: "unreadable" }),
      work({ matchClass: "verify" }),
      work({ extracted: rxExtractionSchema.shape.items.element.parse(line({ name: "ab" })) }),
    ];
    const result = buildResult(extraction, items, new Map());
    expect(unmatchedReadings(items, result)).toEqual([
      { normalized: "dostenix", sample: "Dostenix" },
    ]);
  });
});
