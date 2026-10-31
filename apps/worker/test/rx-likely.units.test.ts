import { rxExtractionSchema, type RxExtraction } from "@wasfa/shared/schemas/rx";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WIDE_CANDIDATES,
  applyVerification,
  buildResult,
  matchItems,
  matchLine,
  oneVariantPerFamily,
  verifyContext,
  type RecognitionSettings,
  type WorkItem,
} from "../src/rx/pipeline.js";

import type { Database } from "@wasfa/db";
import type { RankedCandidate } from "@wasfa/shared/drug-decision";
import type { DrugMatchCandidate } from "@wasfa/shared/drugs";

const { matchDrug, shapeCandidates } = vi.hoisted(() => ({
  matchDrug: vi.fn(),
  shapeCandidates: vi.fn(),
}));
vi.mock("@wasfa/db", () => ({ matchDrug, shapeCandidates }));

/*
 * The "likely" outcome (T1): a handwritten name that the model cannot read clearly is matched against
 * the drug list by letter shape, the model picks a candidate with a confidence, and the line shows the
 * database name with the "مرجّح" badge. These tests run the pipeline without a model: the verify answer
 * is given directly.
 */

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
const RIOPAN = "0190a000-0000-7000-8000-0000000000a1";
const MOTILIUM = "0190a000-0000-7000-8000-0000000000a2";
const OTHER = "0190a000-0000-7000-8000-0000000000a3";

const drug = (
  drugId: string,
  score: number,
  over: Partial<DrugMatchCandidate> = {},
): DrugMatchCandidate => ({
  drugId,
  brandEn: "Riopan",
  brandAr: null,
  brandKey: "riopan",
  form: "suspension",
  strengthText: "250 mg/5 ml",
  manufacturer: null,
  status: "active",
  score,
  explanation: { nameScore: score, matchedOn: "brand", strength: "unknown", form: "unknown" },
  ...over,
});

const ranked = (
  candidate: DrugMatchCandidate,
  via: RankedCandidate["via"] = "shape",
): RankedCandidate => ({
  ...candidate,
  via,
});

const line = (
  over: Partial<RxExtraction["items"][number]> = {},
): RxExtraction["items"][number] => ({
  rawText: "Ripan",
  name: "Ripan",
  activeIngredient: null,
  strength: null,
  form: null,
  dose: null,
  frequency: null,
  duration: null,
  route: null,
  notes: null,
  alternatives: [],
  legibility: "unclear",
  confidence: 0.6,
  box_2d: null,
  page: 0,
  ...over,
});

const extraction = (items: RxExtraction["items"][number][]): RxExtraction =>
  rxExtractionSchema.parse({
    items,
    prescriberLegible: true,
    date: null,
    unreadableRegions: [],
  });

const work = (over: Partial<WorkItem> = {}): WorkItem => ({
  extracted: rxExtractionSchema.shape.items.element.parse(line()),
  candidates: [],
  matchClass: "verify",
  chosen: null,
  familyOnly: false,
  flagged: true,
  verified: "not_needed",
  verifyCeiling: undefined,
  nameOverride: null,
  likely: false,
  suggestion: null,
  ...over,
});

const offered = (items: WorkItem[]): Map<number, RankedCandidate[]> =>
  new Map(items.map((item, index) => [index, [...item.candidates]] as const));

beforeEach(() => {
  matchDrug.mockReset();
  matchDrug.mockResolvedValue([]);
  shapeCandidates.mockReset();
  shapeCandidates.mockResolvedValue([]);
});

describe("likely, suggestion and confirmed outcomes", () => {
  it("a confident candidate pick is likely: the database name, no database strength", async () => {
    const items = [work({ candidates: [ranked(drug(RIOPAN, 0.7))] })];
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "candidate", id: RIOPAN, confidence: 0.82 }] },
      settings,
    );
    const result = buildResult(extraction([line()]), items, new Map([[RIOPAN, ["Magaldrate"]]]));
    expect(result.items[0]).toMatchObject({
      match: "likely",
      source: "database",
      name: "Riopan",
      matchedDrugId: RIOPAN,
      reading: "Ripan",
      strength: null,
      suggestion: null,
      activeIngredients: ["Magaldrate"],
    });
  });

  it("a likely line keeps the strength the prescription wrote, never the database one", async () => {
    const items = [
      work({
        extracted: rxExtractionSchema.shape.items.element.parse(line({ strength: "250 mg" })),
        candidates: [ranked(drug(RIOPAN, 0.7, { strengthText: "500 mg" }))],
      }),
    ];
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "candidate", id: RIOPAN, confidence: 0.9 }] },
      settings,
    );
    const result = buildResult(extraction([line({ strength: "250 mg" })]), items, new Map());
    expect(result.items[0]).toMatchObject({ match: "likely", strength: "250 mg" });
  });

  it("a weak candidate pick leaves the reading as ai and offers the candidate first", async () => {
    const items = [work({ candidates: [ranked(drug(RIOPAN, 0.7))] })];
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "candidate", id: RIOPAN, confidence: 0.6 }] },
      settings,
    );
    const result = buildResult(extraction([line()]), items, new Map());
    expect(result.items[0]).toMatchObject({
      match: "ai",
      source: "ai",
      name: "Ripan",
      matchedDrugId: null,
      suggestion: { drugId: RIOPAN, name: "Riopan" },
    });
  });

  it("the 0.75 threshold: exactly 0.75 is likely, 0.74 is a suggestion", async () => {
    for (const [confidence, expected] of [
      [0.75, "likely"],
      [0.74, "ai"],
    ] as const) {
      const items = [work({ candidates: [ranked(drug(RIOPAN, 0.7))] })];
      await applyVerification(
        db,
        items,
        offered(items),
        { answers: [{ index: 0, kind: "candidate", id: RIOPAN, confidence }] },
        settings,
      );
      const result = buildResult(extraction([line()]), items, new Map());
      expect(result.items[0]?.match).toBe(expected);
    }
  });

  it("a line the database accepts without a second look is confirmed, with the database strength", () => {
    const chosen = ranked(
      drug(RIOPAN, 0.95, {
        explanation: { nameScore: 0.95, matchedOn: "brand", strength: "unknown", form: "unknown" },
      }),
      "primary",
    );
    const result = buildResult(
      extraction([line({ name: "Riopan", legibility: "clear", confidence: 0.95 })]),
      [
        work({
          chosen,
          matchClass: "accept",
          flagged: false,
          extracted: rxExtractionSchema.shape.items.element.parse(
            line({ name: "Riopan", legibility: "clear", confidence: 0.95 }),
          ),
        }),
      ],
      new Map(),
    );
    expect(result.items[0]).toMatchObject({
      match: "confirmed",
      source: "database",
      strength: "250 mg/5 ml",
    });
  });

  it("a re-read the database accepts is likely, never confirmed", async () => {
    const items = [work({ candidates: [] })];
    matchDrug.mockResolvedValue([drug(RIOPAN, 0.95)]);
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "other", text: "Riopan" }] },
      settings,
    );
    expect(items[0]).toMatchObject({ likely: true, verified: "corrected" });
    const result = buildResult(extraction([line()]), items, new Map());
    expect(result.items[0]?.match).toBe("likely");
  });

  it("none, unreadable and an unknown id clear the likely flag", async () => {
    const items = [
      work({ candidates: [ranked(drug(RIOPAN, 0.7))], likely: true }),
      work({ candidates: [ranked(drug(RIOPAN, 0.7))], likely: true }),
    ];
    await applyVerification(
      db,
      items,
      offered(items),
      {
        answers: [
          { index: 0, kind: "none" },
          { index: 1, kind: "candidate", id: OTHER, confidence: 0.99 },
        ],
      },
      settings,
    );
    expect(items[0]).toMatchObject({ likely: false, chosen: null });
    expect(items[1]).toMatchObject({ likely: false, chosen: null, verified: "unreadable" });
  });
});

describe("the wider lookup for an unclear name", () => {
  it("an unclear name gets the letter-shape candidates, which are never accepted", async () => {
    shapeCandidates.mockResolvedValue([drug(RIOPAN, 0.7)]);
    const outcome = await matchLine(db, line({ legibility: "unclear" }), settings);
    expect(shapeCandidates).toHaveBeenCalledWith(db, expect.any(String), expect.anything());
    expect(outcome.candidates[0]).toMatchObject({ drugId: RIOPAN, via: "shape" });
    expect(outcome.decision).toMatchObject({ matchClass: "verify", chosen: null });
  });

  it("a clear name the database accepts does not widen the lookup", async () => {
    matchDrug.mockResolvedValue([drug(RIOPAN, 0.95)]);
    const outcome = await matchLine(
      db,
      line({ name: "Riopan", rawText: "Riopan", legibility: "clear", confidence: 0.95 }),
      settings,
    );
    expect(shapeCandidates).not.toHaveBeenCalled();
    expect(outcome.decision.matchClass).toBe("accept");
  });

  it("an unmatched line that is not clear is flagged for a second look", async () => {
    const items = await matchItems(
      db,
      extraction([
        line({ name: "Motdyl", rawText: "Motdyl", legibility: "partial", confidence: 0.9 }),
      ]),
      settings,
    );
    expect(items[0]).toMatchObject({ matchClass: "unmatched", flagged: true });
  });

  it("end to end without a model: an unclear line with a confident pick is likely", async () => {
    shapeCandidates.mockResolvedValue([drug(RIOPAN, 0.7)]);
    const ex = extraction([line()]);
    const items = await matchItems(db, ex, settings);
    expect(items[0]?.flagged).toBe(true);
    await applyVerification(
      db,
      items,
      offered(items),
      { answers: [{ index: 0, kind: "candidate", id: RIOPAN, confidence: 0.85 }] },
      settings,
    );
    const result = buildResult(ex, items, new Map());
    expect(result.items[0]).toMatchObject({ match: "likely", name: "Riopan", source: "database" });
  });
});

describe("oneVariantPerFamily", () => {
  it("keeps one variant per brand family: the one whose strength the prescription wrote", () => {
    const low = ranked(drug(OTHER, 0.9, { brandKey: "flumox", strengthText: "250 mg" }), "shape");
    const written = ranked(
      drug(RIOPAN, 0.7, {
        brandKey: "flumox",
        strengthText: "500 mg",
        explanation: { nameScore: 0.7, matchedOn: "brand", strength: "match", form: "unknown" },
      }),
      "shape",
    );
    const kept = oneVariantPerFamily([low, written]);
    expect(kept.map((candidate) => candidate.drugId)).toEqual([RIOPAN]);
  });

  it("caps the list at the wide limit", () => {
    const many = Array.from({ length: WIDE_CANDIDATES + 4 }, (_, index) =>
      ranked(
        drug(
          `0190a000-0000-7000-8000-00000000${String(index + 10).padStart(4, "0")}`,
          0.9 - index / 100,
          { brandKey: `fam${index}` },
        ),
      ),
    );
    expect(oneVariantPerFamily(many)).toHaveLength(WIDE_CANDIDATES);
  });
});

describe("verifyContext", () => {
  it("names the other medicines with their ingredient, and the directions of this line", () => {
    const items = [
      work({
        extracted: rxExtractionSchema.shape.items.element.parse(
          line({ dose: "قرص", frequency: "قبل الأكل" }),
        ),
      }),
      work({
        chosen: ranked(drug(MOTILIUM, 0.95, { brandEn: "Motilium" }), "primary"),
        extracted: rxExtractionSchema.shape.items.element.parse(
          line({ name: "Motilium", activeIngredient: "domperidone" }),
        ),
      }),
    ];
    expect(verifyContext(items, 0)).toEqual([
      "Other medicines on this prescription: Motilium (domperidone)",
      "Directions written with this line: قرص | قبل الأكل",
    ]);
  });

  it("says so when nothing else is read", () => {
    const items = [
      work({
        extracted: rxExtractionSchema.shape.items.element.parse(
          line({ dose: null, frequency: null }),
        ),
      }),
    ];
    expect(verifyContext(items, 0)).toEqual([
      "Other medicines on this prescription: none read",
      "Directions written with this line: none read",
    ]);
  });
});
