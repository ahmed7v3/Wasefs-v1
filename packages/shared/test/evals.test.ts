import { describe, expect, it } from "vitest";

import {
  EVAL_SHEET_COLUMNS,
  aggregateEvalRun,
  bandOf,
  evalExpectedSchema,
  groupEvalSheet,
  isEvalRegression,
  nameSimilarity,
  scoreEvalItem,
  type EvalExpected,
  type PredictedLine,
  type ScoredEvalItem,
} from "../src/evals.js";

const line = (over: Partial<PredictedLine> = {}): PredictedLine => ({
  name: "Panadol",
  activeIngredients: [],
  strength: null,
  frequency: null,
  duration: null,
  confidence: 0.9,
  ...over,
});

const expected = (...items: Partial<EvalExpected["items"][number]>[]): EvalExpected => ({
  items: items.map((item) => ({
    name: "Panadol",
    strength: null,
    form: null,
    frequency: null,
    duration: null,
    route: null,
    ...item,
  })),
});

describe("nameSimilarity", () => {
  const cases: [a: string | null, b: string | null, expected: number | "partial" | 0][] = [
    ["Panadol", "panadol", 1],
    ["Panadol 500mg Tabs", "PANADOL", 1],
    ["بانادول", "بانادول", 1],
    ["Augmentin", "Augmentn", "partial"],
    ["Panadol", "Zyrtec", "partial"],
    ["", "Panadol", 0],
    [null, "Panadol", 0],
  ];
  it.each(cases)("%s vs %s", (a, b, want) => {
    const got = nameSimilarity(a, b);
    if (want === "partial") {
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThan(1);
    } else expect(got).toBe(want);
  });

  it("is high for a one-letter slip and low for another drug", () => {
    expect(nameSimilarity("Augmentin", "Augmentn")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Panadol", "Zyrtec")).toBeLessThan(0.5);
  });
});

describe("scoreEvalItem", () => {
  it("a perfect reading", () => {
    const score = scoreEvalItem(
      expected({ name: "Panadol", strength: "500 mg", frequency: "1x3", duration: "5 days" }),
      [
        line({
          name: "Panadol",
          strength: "500mg",
          frequency: "3 مرات يوميًا",
          duration: "5 أيام",
        }),
      ],
    );
    expect(score).toMatchObject({
      expected: 1,
      predicted: 1,
      detected: 1,
      nameCorrect: 1,
      fabricated: 0,
      fields: {
        strength: { labelled: 1, correct: 1 },
        frequency: { labelled: 1, correct: 1 },
        duration: { labelled: 1, correct: 1 },
      },
    });
    expect(score.bands["85-95"]).toEqual({ total: 1, correct: 1 });
  });

  it("a missed line counts against recall, name accuracy and every labelled field", () => {
    const score = scoreEvalItem(
      expected({ name: "Panadol", strength: "500 mg" }, { name: "Zyrtec", strength: "10 mg" }),
      [line({ name: "Panadol", strength: "500 mg" })],
    );
    expect(score.detected).toBe(1);
    expect(score.nameCorrect).toBe(1);
    expect(score.fields.strength).toEqual({ labelled: 2, correct: 1 });
    expect(score.pairs[1]).toMatchObject({ predicted: null, nameCorrect: false, strength: false });
  });

  it("a high-confidence line that is not on the paper is fabricated; a low one is only extra", () => {
    const score = scoreEvalItem(expected({ name: "Panadol" }), [
      line({ name: "Panadol", confidence: 0.9 }),
      line({ name: "Voltaren", confidence: 0.92 }),
      line({ name: "Cataflam", confidence: 0.4 }),
    ]);
    expect(score.fabricated).toBe(1);
    expect(score.extras).toEqual([
      { predicted: 1, confidence: 0.92, fabricated: true },
      { predicted: 2, confidence: 0.4, fabricated: false },
    ]);
    expect(score.bands["0-50"]).toEqual({ total: 1, correct: 0 });
  });

  it("a misread name at high confidence is detected (similar) but wrong, and counts as fabricated", () => {
    const score = scoreEvalItem(expected({ name: "Augmentin" }), [
      line({ name: "Augmentn", confidence: 0.9 }),
    ]);
    expect(score).toMatchObject({ detected: 1, nameCorrect: 0, fabricated: 1 });
    expect(score.pairs[0]).toMatchObject({ nameCorrect: false });
  });

  it("the matched active ingredient may carry the labelled generic name", () => {
    const score = scoreEvalItem(expected({ name: "Paracetamol" }), [
      line({ name: "Panadol", activeIngredients: ["Paracetamol"] }),
    ]);
    expect(score.nameCorrect).toBe(1);
  });

  it("pairs one to one, best first: two labelled lines of one drug need two readings", () => {
    const score = scoreEvalItem(expected({ name: "Panadol" }, { name: "Panadol" }), [
      line({ name: "Panadol" }),
    ]);
    expect(score).toMatchObject({ detected: 1, nameCorrect: 1 });
  });

  const fieldCases: {
    title: string;
    label: Partial<EvalExpected["items"][number]>;
    read: Partial<PredictedLine>;
    field: "strength" | "frequency" | "duration";
    ok: boolean;
  }[] = [
    {
      title: "strength in another mass unit is the same strength",
      label: { strength: "0.5 g" },
      read: { strength: "500mg" },
      field: "strength",
      ok: true,
    },
    {
      title: "strength same value and unit",
      label: { strength: "500 mg" },
      read: { strength: "500MG" },
      field: "strength",
      ok: true,
    },
    {
      title: "strength Arabic unit",
      label: { strength: "500 ملجم" },
      read: { strength: "500 mg" },
      field: "strength",
      ok: true,
    },
    {
      title: "strength wrong value",
      label: { strength: "500 mg" },
      read: { strength: "250 mg" },
      field: "strength",
      ok: false,
    },
    {
      title: "strength missing",
      label: { strength: "500 mg" },
      read: { strength: null },
      field: "strength",
      ok: false,
    },
    {
      title: "frequency abbreviation vs phrase",
      label: { frequency: "tid" },
      read: { frequency: "3 مرات يوميًا" },
      field: "frequency",
      ok: true,
    },
    {
      title: "frequency 1x3 vs 3x1",
      label: { frequency: "1x3" },
      read: { frequency: "3 مرات يوميًا" },
      field: "frequency",
      ok: true,
    },
    {
      title: "frequency different",
      label: { frequency: "bid" },
      read: { frequency: "3 مرات يوميًا" },
      field: "frequency",
      ok: false,
    },
    {
      title: "duration x 5 days",
      label: { duration: "x 5 days" },
      read: { duration: "5 أيام" },
      field: "duration",
      ok: true,
    },
    {
      title: "duration different",
      label: { duration: "5 days" },
      read: { duration: "7 أيام" },
      field: "duration",
      ok: false,
    },
  ];
  it.each(fieldCases)("$title", ({ label, read, field, ok }) => {
    const score = scoreEvalItem(expected({ name: "Panadol", ...label }), [line(read)]);
    expect(score.fields[field]).toEqual({ labelled: 1, correct: ok ? 1 : 0 });
  });

  it("an unlabelled field is not scored", () => {
    const score = scoreEvalItem(expected({ name: "Panadol" }), [line({ strength: "999 mg" })]);
    expect(score.fields.strength).toEqual({ labelled: 0, correct: 0 });
  });

  it("nothing labelled and nothing read is a clean zero", () => {
    expect(scoreEvalItem({ items: [] }, [])).toMatchObject({
      expected: 0,
      predicted: 0,
      detected: 0,
      fabricated: 0,
    });
  });

  it("a blank prescription read as having drugs is all extras", () => {
    const score = scoreEvalItem({ items: [] }, [line({ confidence: 0.99 })]);
    expect(score).toMatchObject({ predicted: 1, fabricated: 1 });
  });
});

describe("bandOf", () => {
  const cases: [number, string][] = [
    [0, "0-50"],
    [0.49, "0-50"],
    [0.5, "50-70"],
    [0.7, "70-85"],
    [0.84, "70-85"],
    [0.85, "85-95"],
    [0.95, "95-100"],
    [1, "95-100"],
  ];
  it.each(cases)("%s -> %s", (confidence, band) => {
    expect(bandOf(confidence)).toBe(band);
  });
});

describe("aggregateEvalRun", () => {
  const item = (
    kind: ScoredEvalItem["kind"],
    exp: EvalExpected,
    pred: PredictedLine[] | null,
    cost: number,
    latencyMs: number | null,
  ): ScoredEvalItem => ({
    kind,
    score: pred === null ? null : scoreEvalItem(exp, pred),
    costUsdMicros: cost,
    latencyMs,
  });

  it("splits printed and handwritten, and reports calibration, cost and latency", () => {
    const metrics = aggregateEvalRun([
      item(
        "printed",
        expected({ name: "Panadol", strength: "500 mg" }),
        [line({ strength: "500 mg", confidence: 0.9 })],
        4_000,
        8_000,
      ),
      item(
        "printed",
        expected({ name: "Zyrtec" }, { name: "Augmentin" }),
        [line({ name: "Zyrtec", confidence: 0.97 })],
        6_000,
        12_000,
      ),
      item(
        "handwritten",
        expected({ name: "Voltaren" }),
        [line({ name: "Panadol", confidence: 0.9 })],
        10_000,
        20_000,
      ),
      item("handwritten", expected({ name: "Cataflam" }), null, 1_000, null),
    ]);

    expect(metrics.printed).toMatchObject({
      items: 2,
      failed: 0,
      expected: 3,
      predicted: 2,
      detected: 2,
      nameCorrect: 2,
      fabricated: 0,
      costUsdMicros: 10_000,
      latencyP50Ms: 8_000,
      latencyP95Ms: 12_000,
    });
    expect(metrics.printed.nameAccuracy).toBeCloseTo(2 / 3, 3);
    expect(metrics.printed.recall).toBeCloseTo(2 / 3, 3);
    expect(metrics.printed.strength).toEqual({ labelled: 1, correct: 1, accuracy: 1 });

    expect(metrics.handwritten).toMatchObject({
      items: 1,
      failed: 1,
      expected: 1,
      predicted: 1,
      detected: 0,
      nameCorrect: 0,
      nameAccuracy: 0,
      fabricated: 1,
      fabricationRate: 1,
      costUsdMicros: 11_000,
      latencyP50Ms: 20_000,
    });

    expect(metrics.overall).toMatchObject({
      expected: 4,
      nameCorrect: 2,
      fabricated: 1,
      failed: 1,
    });
    expect(metrics.score).toBe(50);
    const band9 = metrics.overall.calibration.find((band) => band.band === "85-95");
    expect(band9).toEqual({ band: "85-95", total: 2, correct: 1, accuracy: 0.5 });
    const band95 = metrics.overall.calibration.find((band) => band.band === "95-100");
    expect(band95).toEqual({ band: "95-100", total: 1, correct: 1, accuracy: 1 });
    expect(metrics.overall.calibration.find((band) => band.band === "0-50")?.accuracy).toBeNull();
  });

  it("an empty run has null ratios, not NaN", () => {
    const metrics = aggregateEvalRun([]);
    expect(metrics.score).toBeNull();
    expect(metrics.overall).toMatchObject({
      items: 0,
      nameAccuracy: null,
      recall: null,
      fabricationRate: null,
      latencyP50Ms: null,
    });
  });
});

describe("isEvalRegression", () => {
  const cases: [current: number | null, candidate: number | null, regression: boolean][] = [
    [90, 88.9, true],
    [90, 89, false],
    [90, 89.5, false],
    [90, 95, false],
    [null, 50, false],
    [90, null, false],
  ];
  it.each(cases)("%s -> %s is %s", (current, candidate, want) => {
    expect(isEvalRegression(current, candidate)).toBe(want);
  });
});

describe("groupEvalSheet", () => {
  const headers = [...EVAL_SHEET_COLUMNS];
  const row = (n: number, cells: Record<string, string>) => ({ row: n, cells });

  it("groups rows by image, orders by item number, and keeps empty cells null", () => {
    const { items, issues } = groupEvalSheet(headers, [
      row(2, {
        image_file: "a.jpg",
        kind: "Printed",
        item_no: "2",
        drug: "Zyrtec",
        strength: "10 mg",
      }),
      row(3, {
        image_file: "a.jpg",
        kind: "printed",
        item_no: "1",
        drug: "Panadol",
        frequency: "tid",
      }),
      row(4, { image_file: "b.jpg;b2.jpg", kind: "handwritten", item_no: "", drug: "Augmentin" }),
      row(5, { image_file: "c.jpg", kind: "printed", item_no: "", drug: "" }),
    ]);
    expect(issues).toEqual([]);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ imageNames: ["a.jpg"], kind: "printed" });
    expect(items[0]?.expected.items.map((i) => i.name)).toEqual(["Panadol", "Zyrtec"]);
    expect(items[0]?.expected.items[0]).toMatchObject({ frequency: "tid", strength: null });
    expect(items[1]).toMatchObject({ imageNames: ["b.jpg", "b2.jpg"], kind: "handwritten" });
    expect(items[2]?.expected.items).toEqual([]);
    for (const it of items) expect(evalExpectedSchema.safeParse(it.expected).success).toBe(true);
  });

  const bad: [title: string, cells: Record<string, string>, code: string][] = [
    ["no image", { image_file: "", kind: "printed", drug: "x" }, "image_required"],
    ["bad kind", { image_file: "a.jpg", kind: "typed", drug: "x" }, "bad_kind"],
    ["five pages", { image_file: "1;2;3;4;5", kind: "printed", drug: "x" }, "too_many_pages"],
  ];
  it.each(bad)("%s is reported per row", (_title, cells, code) => {
    const { items, issues } = groupEvalSheet(headers, [row(7, cells)]);
    expect(items).toEqual([]);
    expect(issues).toEqual([{ row: 7, code }]);
  });

  it("one image cannot be both printed and handwritten, nor repeat an item number", () => {
    const { issues } = groupEvalSheet(headers, [
      row(2, { image_file: "a.jpg", kind: "printed", item_no: "1", drug: "x" }),
      row(3, { image_file: "a.jpg", kind: "handwritten", item_no: "2", drug: "y" }),
      row(4, { image_file: "a.jpg", kind: "printed", item_no: "1", drug: "z" }),
    ]);
    expect(issues).toEqual([
      { row: 3, code: "kind_conflict" },
      { row: 4, code: "duplicate_item_no" },
    ]);
  });

  it("headers are matched loosely and a missing key column is one clear error", () => {
    const ok = groupEvalSheet(
      ["Image File", "KIND", "Item No", "Drug"],
      [row(2, { "Image File": "a.jpg", KIND: "printed", Drug: "x" })],
    );
    expect(ok.issues).toEqual([]);
    expect(ok.items).toHaveLength(1);
    expect(groupEvalSheet(["image_file", "drug"], [])).toEqual({
      items: [],
      issues: [{ row: 1, code: "missing_column" }],
    });
  });
});
