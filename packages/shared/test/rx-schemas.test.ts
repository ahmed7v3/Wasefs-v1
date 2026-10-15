import { describe, expect, it } from "vitest";

import {
  confidenceBadge,
  duplicateIngredientFindings,
  finalConfidence,
  RX_UNMATCHED_CONFIDENCE_CAP,
} from "../src/rx-result.js";
import {
  rxDetailsAnswerSchema,
  rxDetailsJsonSchema,
  rxExtractionJsonSchema,
  rxExtractionSchema,
  rxResultSchema,
  rxVerifyAnswerSchema,
  rxVerifyJsonSchema,
  type RxResultItem,
} from "../src/schemas/rx.js";

/*
 * The JSON schemas sent to the provider are written by hand. This test keeps them honest: every
 * fixture is judged by the zod schema AND by a small validator of the JSON-schema subset we use,
 * and the two must agree. (Zod strips unknown keys while the JSON schema is closed, so extra-key
 * cases are deliberately not fixtures: the provider is told to be strict, we are tolerant.)
 */

type Json = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Validates the keywords the rx schemas use: type, properties, required, additionalProperties, items, enum, anyOf, min/max, minItems/maxItems, maxLength. */
function validate(schema: Json, value: unknown): boolean {
  if (Array.isArray(schema.anyOf)) {
    return (schema.anyOf as Json[]).some((option) => validate(option, value));
  }
  const types = ([] as unknown[]).concat(schema.type ?? []);
  const actual = typeOf(value);
  if (
    types.length > 0 &&
    !types.some((t) => t === actual || (t === "number" && actual === "integer"))
  ) {
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (typeof value === "string" && typeof schema.maxLength === "number") {
    if (value.length > schema.maxLength) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.items !== undefined) {
      return value.every((entry) => validate(schema.items as Json, entry));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Json;
    const properties = (schema.properties ?? {}) as Record<string, Json>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) return false;
    }
    if (schema.additionalProperties === false) {
      if (Object.keys(record).some((key) => !(key in properties))) return false;
    }
    return Object.entries(properties).every(
      ([key, sub]) => !(key in record) || validate(sub, record[key]),
    );
  }
  return true;
}

const item = {
  rawText: "Augmentin 1g 1x2 x 7 days",
  name: "Augmentin",
  activeIngredient: "amoxicillin and clavulanic acid",
  strength: "1 g",
  form: "tablet",
  dose: "1 tab",
  frequency: "1x2",
  duration: "x 7 days",
  route: null,
  notes: null,
  confidence: 0.92,
  box_2d: [100, 50, 160, 900],
  page: 0,
};

const extraction = {
  items: [item],
  prescriberLegible: true,
  date: "2026-10-01",
  unreadableRegions: [{ page: 0, box_2d: [800, 100, 900, 400] }],
};

const extractionCases: [name: string, value: unknown, valid: boolean][] = [
  ["a normal reading", extraction, true],
  ["no items", { ...extraction, items: [], unreadableRegions: [] }, true],
  [
    "null fields and no box",
    { ...extraction, items: [{ ...item, name: null, activeIngredient: null, box_2d: null }] },
    true,
  ],
  ["confidence above 1", { ...extraction, items: [{ ...item, confidence: 1.4 }] }, false],
  ["negative confidence", { ...extraction, items: [{ ...item, confidence: -0.1 }] }, false],
  ["page out of range", { ...extraction, items: [{ ...item, page: 4 }] }, false],
  ["box with three numbers", { ...extraction, items: [{ ...item, box_2d: [1, 2, 3] }] }, false],
  ["box outside 0-1000", { ...extraction, items: [{ ...item, box_2d: [0, 0, 10, 1001] }] }, false],
  ["missing field", { ...extraction, items: [{ ...item, dose: undefined }] }, false],
  ["text where a boolean belongs", { ...extraction, prescriberLegible: "yes" }, false],
  ["missing items", { prescriberLegible: true, date: null, unreadableRegions: [] }, false],
  ["too many items", { ...extraction, items: Array.from({ length: 41 }, () => item) }, false],
];

describe("rxExtractionJsonSchema", () => {
  it.each(extractionCases)("agrees with zod: %s", (_name, value, valid) => {
    // JSON.parse(JSON.stringify()) drops `undefined`, which is what a provider's answer looks like.
    const wire: unknown = JSON.parse(JSON.stringify(value));
    expect(rxExtractionSchema.safeParse(wire).success).toBe(valid);
    expect(validate(rxExtractionJsonSchema as unknown as Json, wire)).toBe(valid);
  });
});

const ID = "018f0000-0000-7000-8000-000000000001";
const verifyCases: [name: string, value: unknown, valid: boolean][] = [
  [
    "all three answer kinds",
    {
      answers: [
        { index: 0, kind: "candidate", id: ID },
        { index: 1, kind: "other", text: "Cataflam 50" },
        { index: 2, kind: "unreadable" },
      ],
    },
    true,
  ],
  ["no answers", { answers: [] }, true],
  ["a candidate without an id", { answers: [{ index: 0, kind: "candidate" }] }, false],
  ["other without text", { answers: [{ index: 0, kind: "other" }] }, false],
  ["a kind we do not know", { answers: [{ index: 0, kind: "guess" }] }, false],
];

describe("rxVerifyJsonSchema", () => {
  it.each(verifyCases)("agrees with zod: %s", (_name, value, valid) => {
    expect(rxVerifyAnswerSchema.safeParse(value).success).toBe(valid);
    expect(validate(rxVerifyJsonSchema as unknown as Json, value)).toBe(valid);
  });
});

function resultItem(overrides: Partial<RxResultItem> = {}): RxResultItem {
  return {
    rawText: "x",
    name: "Panadol",
    matchedDrugId: ID,
    matchScore: 0.95,
    activeIngredients: [],
    strength: null,
    form: null,
    dose: null,
    frequency: null,
    duration: null,
    route: null,
    notes: null,
    confidence: 0.9,
    badge: "high",
    verified: "not_needed",
    box_2d: null,
    page: 0,
    ...overrides,
  };
}

describe("rxResultSchema", () => {
  const base = {
    schemaVersion: 1,
    items: [resultItem()],
    date: null,
    prescriberLegible: true,
    findings: [],
    unreadableRegions: [],
  };

  it("accepts a matched high-confidence line", () => {
    expect(rxResultSchema.safeParse(base).success).toBe(true);
  });

  it("refuses an unmatched line shown as high confidence", () => {
    const bad = { ...base, items: [resultItem({ matchedDrugId: null, matchScore: null })] };
    expect(rxResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("finalConfidence and confidenceBadge", () => {
  it("takes the lowest of model, match and verification", () => {
    expect(finalConfidence({ model: 0.95, match: 0.9 })).toBe(0.9);
    expect(finalConfidence({ model: 0.7, match: 0.99 })).toBe(0.7);
    expect(finalConfidence({ model: 0.95, match: 0.95, verify: 0.6 })).toBe(0.6);
  });

  it("caps an unmatched name below the high threshold", () => {
    const confidence = finalConfidence({ model: 0.99, match: null });
    expect(confidence).toBe(RX_UNMATCHED_CONFIDENCE_CAP);
    expect(confidenceBadge(confidence)).toBe("medium");
  });

  it("draws the badge lines at 0.85 and 0.5", () => {
    expect(confidenceBadge(0.85)).toBe("high");
    expect(confidenceBadge(0.8499)).toBe("medium");
    expect(confidenceBadge(0.5)).toBe("medium");
    expect(confidenceBadge(0.4999)).toBe("low");
  });
});

describe("duplicateIngredientFindings", () => {
  it("reports an ingredient shared by two lines, ignoring case and Arabic spelling", () => {
    const findings = duplicateIngredientFindings([
      { activeIngredients: ["Paracetamol"] },
      { activeIngredients: ["Ibuprofen"] },
      { activeIngredients: ["paracetamol", "Caffeine"] },
    ]);
    expect(findings).toEqual([
      { kind: "duplicate_ingredient", itemIndexes: [0, 2], ingredient: "Paracetamol" },
    ]);
  });

  it("does not report one line that lists an ingredient twice, or lines with no ingredients", () => {
    expect(
      duplicateIngredientFindings([
        { activeIngredients: ["Zinc", "zinc"] },
        { activeIngredients: [] },
      ]),
    ).toEqual([]);
  });
});

describe("rxExtractionSchema trims over-long text instead of rejecting the reading", () => {
  const item = {
    rawText: "Dostinex ".repeat(60),
    name: "Dostinex",
    strength: null,
    form: null,
    dose: null,
    frequency: null,
    duration: null,
    route: null,
    notes: "n".repeat(500),
    confidence: 0.7,
    box_2d: [10, 10, 50, 90],
    page: 0,
  };

  it("keeps a valid reading whose date, notes and raw text are too long", () => {
    const parsed = rxExtractionSchema.parse({
      items: [item],
      prescriberLegible: false,
      date: "13/12/2022 (the last digit is hard to read, possibly 2023)",
      unreadableRegions: [],
    });
    expect(parsed.date?.length).toBe(40);
    expect(parsed.items[0]?.notes?.length).toBe(200);
    expect(parsed.items[0]?.rawText.length).toBe(300);
  });
});

describe("model-only results and the details step", () => {
  const modelItem = (overrides: Partial<RxResultItem> = {}): RxResultItem =>
    resultItem({
      matchedDrugId: null,
      matchScore: null,
      badge: "high",
      confidence: 0.92,
      ...overrides,
    });
  const base = {
    schemaVersion: 1,
    date: null,
    prescriberLegible: true,
    findings: [],
    unreadableRegions: [],
  };

  it("lets an unmatched line be high only when the model read it alone", () => {
    expect(rxResultSchema.safeParse({ ...base, items: [modelItem()] }).success).toBe(false);
    expect(
      rxResultSchema.safeParse({ ...base, matching: "database", items: [modelItem()] }).success,
    ).toBe(false);
    expect(
      rxResultSchema.safeParse({ ...base, matching: "model", items: [modelItem()] }).success,
    ).toBe(true);
  });

  it("accepts details and an overview, and trims over-long phrases", () => {
    const parsed = rxResultSchema.parse({
      ...base,
      matching: "model",
      detailsStatus: "ready",
      overview: { summary: "s".repeat(900), likelyConditions: ["قد يُستخدم في الحساسية"] },
      items: [
        modelItem({
          details: {
            purpose: "يُستخدم عادةً لخفض الحرارة",
            sideEffects: ["غثيان"],
            precautions: [],
          },
        }),
      ],
    });
    expect(parsed.overview?.summary.length).toBe(600);
    expect(parsed.items[0]?.details?.sideEffects).toEqual(["غثيان"]);
  });

  it("still reads results stored before details existed", () => {
    expect(rxResultSchema.safeParse({ ...base, items: [resultItem()] }).success).toBe(true);
  });

  it("validates the details answer", () => {
    const answer = {
      items: [{ index: 0, purpose: null, sideEffects: [], precautions: [] }],
      overview: null,
    };
    expect(rxDetailsAnswerSchema.safeParse(answer).success).toBe(true);
    expect(
      rxDetailsAnswerSchema.safeParse({ items: [{ index: -1 }], overview: null }).success,
    ).toBe(false);
    expect(rxDetailsJsonSchema.required).toEqual(["items", "overview"]);
  });

  it("finalConfidence keeps the model's own number without the database", () => {
    expect(finalConfidence({ model: 0.92, match: null, modelOnly: true })).toBe(0.92);
    expect(finalConfidence({ model: 0.92, match: null })).toBe(RX_UNMATCHED_CONFIDENCE_CAP);
  });
});
