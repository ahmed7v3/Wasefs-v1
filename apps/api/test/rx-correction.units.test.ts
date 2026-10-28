import {
  RX_SCHEMA_VERSION,
  rxResultSchema,
  type RxResult,
  type RxResultItem,
} from "@wasfa/shared/schemas/rx";
import { describe, expect, it } from "vitest";

import { applyCorrection } from "../src/rx/rx-correction.js";

const item = (overrides: Partial<RxResultItem> = {}): RxResultItem => ({
  rawText: "x",
  name: "Panadol",
  matchedDrugId: "0190a000-0000-7000-8000-000000000002",
  matchScore: 0.97,
  activeIngredients: [],
  strength: "500 mg",
  form: "tablet",
  dose: null,
  frequency: "3 مرات يوميًا",
  duration: null,
  route: null,
  notes: null,
  confidence: 0.97,
  badge: "high",
  verified: "not_needed",
  box_2d: null,
  page: 0,
  ...overrides,
});

const result = (items: RxResultItem[], findings: RxResult["findings"] = []): RxResult => ({
  schemaVersion: RX_SCHEMA_VERSION,
  items,
  date: null,
  prescriberLegible: true,
  findings,
  unreadableRegions: [],
});

const drug = {
  id: "0190a000-0000-7000-8000-000000000001",
  brandEn: "Cetal",
  ingredients: ["Paracetamol"],
};

describe("applyCorrection", () => {
  it("returns null for a line that does not exist", () => {
    expect(
      applyCorrection(result([item()]), { itemIndex: 1, field: "dose", after: "1" }, null),
    ).toBeNull();
  });

  it("changes a text field, keeps the rest and reports the value before", () => {
    const applied = applyCorrection(
      result([item()]),
      { itemIndex: 0, field: "frequency", after: " مرتين يوميًا " },
      null,
    );
    expect(applied?.before).toBe("3 مرات يوميًا");
    expect(applied?.result.items[0]).toMatchObject({
      frequency: "مرتين يوميًا",
      verified: "corrected",
      name: "Panadol",
    });
    expect(rxResultSchema.safeParse(applied?.result).success).toBe(true);
  });

  it("makes a picked drug a confirmed match with its ingredients", () => {
    const applied = applyCorrection(
      result([item({ confidence: 0.4, badge: "low" })]),
      { itemIndex: 0, field: "drug", after: drug.id },
      drug,
    );
    expect(applied?.before).toBe("Panadol");
    expect(applied?.result.items[0]).toMatchObject({
      matchedDrugId: drug.id,
      name: "Cetal",
      activeIngredients: ["Paracetamol"],
      badge: "high",
    });
    expect(rxResultSchema.safeParse(applied?.result).success).toBe(true);
  });

  it("makes a typed drug name high when the model read on its own, and drops stale details", () => {
    const modelOnly: RxResult = {
      ...result([
        item({
          matchedDrugId: null,
          matchScore: null,
          confidence: 0.6,
          badge: "medium",
          details: { purpose: "x", sideEffects: [], precautions: [] },
        }),
      ]),
      matching: "model",
    };
    const applied = applyCorrection(
      modelOnly,
      { itemIndex: 0, field: "drug", after: "Adol" },
      null,
    );
    const fixed = applied?.result.items[0];
    expect(fixed).toMatchObject({ name: "Adol", confidence: 1, badge: "high", details: null });
    expect(rxResultSchema.safeParse(applied?.result).success).toBe(true);
  });

  it("keeps a typed drug name unmatched and below high", () => {
    const applied = applyCorrection(
      result([item({ matchedDrugId: drug.id, activeIngredients: ["Paracetamol"] })]),
      { itemIndex: 0, field: "drug", after: "Home remedy" },
      null,
    );
    const fixed = applied?.result.items[0];
    expect(fixed).toMatchObject({
      name: "Home remedy",
      matchedDrugId: null,
      matchScore: null,
      activeIngredients: [],
    });
    expect(fixed?.badge).toBe("medium");
    expect(fixed?.confidence).toBeLessThanOrEqual(0.84);
    expect(rxResultSchema.safeParse(applied?.result).success).toBe(true);
  });

  it("recomputes the duplicate-ingredient finding and drops the strength warning it fixed", () => {
    const base = result(
      [
        item({ activeIngredients: ["Paracetamol"] }),
        item({ name: "Other", activeIngredients: [] }),
      ],
      [{ kind: "strength_unknown", itemIndexes: [1], ingredient: null }],
    );
    const applied = applyCorrection(
      base,
      { itemIndex: 1, field: "ingredient", after: "paracetamol" },
      null,
    );
    expect(applied?.result.findings).toEqual([
      { kind: "duplicate_ingredient", itemIndexes: [0, 1], ingredient: "Paracetamol" },
      { kind: "strength_unknown", itemIndexes: [1], ingredient: null },
    ]);
    const strength = applyCorrection(
      base,
      { itemIndex: 1, field: "strength", after: "250 mg" },
      null,
    );
    expect(strength?.result.findings).toEqual([]);
  });

  it("labels the source of a corrected drug line", () => {
    const picked = applyCorrection(
      result([item({ matchedDrugId: null })]),
      { itemIndex: 0, field: "drug", after: drug.id },
      drug,
    );
    expect(picked?.result.items[0]?.source).toBe("database");
    const typed = applyCorrection(
      result([item()]),
      { itemIndex: 0, field: "drug", after: "Something" },
      null,
    );
    expect(typed?.result.items[0]?.source).toBe("ai");
  });
});
