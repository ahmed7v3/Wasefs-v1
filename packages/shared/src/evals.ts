/*
 * Accuracy evaluation of prescription reading (Phase 2, Task 2.10): the label sheet, and the pure
 * scoring of one reading against the labelled truth. The worker runs the real pipeline and stores
 * what this file computes; the admin page only displays it. No I/O here, so every rule is a table
 * test.
 *
 * Definitions (the owner reads these numbers to choose a route, so they are written down):
 *  - An expected line is DETECTED when some predicted line has a name similar enough to it
 *    (one-to-one, best pairs first). Recall = detected / expected.
 *  - A detected line is NAME-CORRECT when the normalized names are equal (or the prediction's
 *    active ingredient equals the labelled generic). Name accuracy = name-correct / expected, so a
 *    missed line counts against it as well as against recall.
 *  - Strength / frequency / duration accuracy = correct / labelled (a field left empty in the sheet
 *    is not scored). A line that was not detected has every labelled field wrong.
 *  - FABRICATED = a predicted line shown with the `high` badge that is not a name-correct reading
 *    of a labelled line (invented, or a wrong drug). The Targets table wants zero.
 *  - Calibration = per confidence band, the share of predicted lines that are name-correct.
 */
import { z } from "zod";

import {
  normalizeArabic,
  normalizeDrugName,
  parseStrength,
  strengthMicro,
  type Strength,
} from "./normalize.js";
import { normalizeDuration, normalizeFrequency } from "./rx-normalize.js";
import { EVAL_ITEM_KINDS, RX_MAX_PAGES } from "./rx.js";
import { RX_BADGE_HIGH } from "./schemas/rx.js";

import type { EvalItemKind } from "./rx.js";

/** Object-storage prefix of the eval images (private bucket, never served to users). */
export const EVAL_IMAGE_PREFIX = "evals/rx/";
/** Where an uploaded import waits (sheet, images and a manifest) until the worker has processed it. */
export const EVAL_STAGING_PREFIX = "evals/rx/staging/";
export const evalImageKey = (fileId: string): string => `${EVAL_IMAGE_PREFIX}${fileId}/processed`;
export const evalStagingKey = (batchId: string, name: string): string =>
  `${EVAL_STAGING_PREFIX}${batchId}/${name}`;

/** A route whose last score is lower than the current one by more than this many points needs a reason. */
export const EVAL_REGRESSION_POINTS = 1;
/** An expected line counts as read (detected) when a predicted name is at least this similar. */
export const EVAL_DETECT_MIN_SIMILARITY = 0.5;

// --- The label sheet -----------------------------------------------------------------------

/** Header cells of the label sheet, in column order. The importer matches them case-insensitively. */
export const EVAL_SHEET_COLUMNS = [
  "image_file",
  "kind",
  "item_no",
  "drug",
  "strength",
  "form",
  "frequency",
  "duration",
  "route",
] as const;
export type EvalSheetColumn = (typeof EVAL_SHEET_COLUMNS)[number];

/** One prescription may have several pages: list the file names in one cell, separated by `;`. */
export const EVAL_PAGE_SEPARATOR = ";";
export const EVAL_MAX_ITEMS_PER_PRESCRIPTION = 40;

const labelText = z.string().trim().max(200).nullable();

/**
 * The labelled truth of one prescription: the fields of a `rxResultSchema` item that a person can
 * read off the paper. Confidence, badge and matching are the pipeline's business, not the label's.
 */
export const evalExpectedSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        strength: labelText,
        form: labelText,
        frequency: labelText,
        duration: labelText,
        route: labelText,
      }),
    )
    .max(EVAL_MAX_ITEMS_PER_PRESCRIPTION),
  /** Set on items made from user corrections: which ones, so the review queue never offers them twice. */
  origin: z
    .object({
      correctionIds: z.array(z.uuid()).max(50).default([]),
      /** Set on items made from a rated analysis the person agreed to share. */
      analysisId: z.uuid().optional(),
    })
    .optional(),
});
export type EvalExpected = z.output<typeof evalExpectedSchema>;
export type EvalExpectedItem = EvalExpected["items"][number];

export const EVAL_SHEET_ERRORS = [
  "missing_column",
  "image_required",
  "bad_kind",
  "kind_conflict",
  "too_many_pages",
  "too_many_items",
  "duplicate_item_no",
] as const;
export type EvalSheetError = (typeof EVAL_SHEET_ERRORS)[number];

export interface EvalSheetRow {
  /** The line number the labeller sees in Excel (the header is row 1). */
  row: number;
  cells: Readonly<Record<string, string>>;
}

export interface EvalSheetIssue {
  row: number;
  code: EvalSheetError;
}

export interface EvalSheetItem {
  /** File names as written in the sheet, in page order. */
  imageNames: string[];
  kind: EvalItemKind;
  expected: EvalExpected;
}

const headerKey = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/**
 * Groups the sheet rows into prescriptions (one per distinct `image_file` cell). Pure: the caller
 * reads the workbook. A row with an empty `drug` says "nothing to read on this image". Problems are
 * returned per row so the labeller can fix the sheet, never thrown.
 */
export function groupEvalSheet(
  headers: readonly string[],
  rows: readonly EvalSheetRow[],
): { items: EvalSheetItem[]; issues: EvalSheetIssue[] } {
  const present = new Set(headers.map(headerKey));
  const issues: EvalSheetIssue[] = [];
  for (const column of ["image_file", "kind", "drug"] as const) {
    if (!present.has(column)) issues.push({ row: 1, code: "missing_column" });
  }
  if (issues.length > 0) return { items: [], issues };

  interface Group {
    imageNames: string[];
    kind: EvalItemKind | null;
    lines: { itemNo: number | null; item: EvalExpectedItem | null }[];
    firstRow: number;
  }
  const groups = new Map<string, Group>();
  const cell = (row: EvalSheetRow, column: EvalSheetColumn): string => {
    for (const [header, value] of Object.entries(row.cells)) {
      if (headerKey(header) === column) return value.trim();
    }
    return "";
  };
  const orNull = (value: string): string | null => (value === "" ? null : value);

  for (const row of rows) {
    const imageCell = cell(row, "image_file");
    const imageNames = imageCell
      .split(EVAL_PAGE_SEPARATOR)
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (imageNames.length === 0) {
      issues.push({ row: row.row, code: "image_required" });
      continue;
    }
    if (imageNames.length > RX_MAX_PAGES) {
      issues.push({ row: row.row, code: "too_many_pages" });
      continue;
    }
    const kind = cell(row, "kind").toLowerCase();
    if (!(EVAL_ITEM_KINDS as readonly string[]).includes(kind)) {
      issues.push({ row: row.row, code: "bad_kind" });
      continue;
    }
    const key = imageNames.join(EVAL_PAGE_SEPARATOR).toLowerCase();
    const group = groups.get(key) ?? {
      imageNames,
      kind: null,
      lines: [],
      firstRow: row.row,
    };
    groups.set(key, group);
    if (group.kind !== null && group.kind !== kind) {
      issues.push({ row: row.row, code: "kind_conflict" });
      continue;
    }
    group.kind = kind as EvalItemKind;

    const itemNoText = cell(row, "item_no");
    const itemNo = /^\d{1,3}$/.test(itemNoText) ? Number(itemNoText) : null;
    if (itemNo !== null && group.lines.some((line) => line.itemNo === itemNo)) {
      issues.push({ row: row.row, code: "duplicate_item_no" });
      continue;
    }
    const drug = cell(row, "drug");
    group.lines.push({
      itemNo,
      item:
        drug === ""
          ? null
          : {
              name: drug,
              strength: orNull(cell(row, "strength")),
              form: orNull(cell(row, "form")),
              frequency: orNull(cell(row, "frequency")),
              duration: orNull(cell(row, "duration")),
              route: orNull(cell(row, "route")),
            },
    });
  }

  const items: EvalSheetItem[] = [];
  for (const group of groups.values()) {
    if (group.kind === null) continue;
    // Item numbers decide the order when the labeller gave them; otherwise the order of the rows.
    const ordered = group.lines
      .map((line, index) => ({ ...line, index }))
      .sort(
        (a, b) =>
          (a.itemNo ?? Number.MAX_SAFE_INTEGER) - (b.itemNo ?? Number.MAX_SAFE_INTEGER) ||
          a.index - b.index,
      );
    const expectedItems = ordered.flatMap((line) => (line.item === null ? [] : [line.item]));
    if (expectedItems.length > EVAL_MAX_ITEMS_PER_PRESCRIPTION) {
      issues.push({ row: group.firstRow, code: "too_many_items" });
      continue;
    }
    items.push({
      imageNames: group.imageNames,
      kind: group.kind,
      expected: { items: expectedItems },
    });
  }
  return { items, issues };
}

// --- Scoring one reading -------------------------------------------------------------------

/** Confidence bands of the calibration table (lower bound inclusive, the last band includes 1). */
export const EVAL_CONFIDENCE_BANDS = [
  { key: "0-50", min: 0, max: 0.5 },
  { key: "50-70", min: 0.5, max: 0.7 },
  { key: "70-85", min: 0.7, max: RX_BADGE_HIGH },
  { key: "85-95", min: RX_BADGE_HIGH, max: 0.95 },
  { key: "95-100", min: 0.95, max: 1.0000001 },
] as const;
export type EvalBandKey = (typeof EVAL_CONFIDENCE_BANDS)[number]["key"];
export const EVAL_BAND_KEYS = EVAL_CONFIDENCE_BANDS.map((band) => band.key) as [
  EvalBandKey,
  ...EvalBandKey[],
];

export function bandOf(confidence: number): EvalBandKey {
  const band = EVAL_CONFIDENCE_BANDS.find((b) => confidence >= b.min && confidence < b.max);
  return band?.key ?? "0-50";
}

const fieldCount = z.object({
  labelled: z.number().int().min(0),
  correct: z.number().int().min(0),
});

const bandCount = z.object({ total: z.number().int().min(0), correct: z.number().int().min(0) });

/** What is stored in `ai_eval_results.scores`. */
export const evalItemScoreSchema = z.object({
  expected: z.number().int().min(0),
  predicted: z.number().int().min(0),
  detected: z.number().int().min(0),
  nameCorrect: z.number().int().min(0),
  fields: z.object({ strength: fieldCount, frequency: fieldCount, duration: fieldCount }),
  fabricated: z.number().int().min(0),
  bands: z.record(z.enum(EVAL_BAND_KEYS), bandCount),
  pairs: z.array(
    z.object({
      expected: z.number().int().min(0),
      predicted: z.number().int().min(0).nullable(),
      similarity: z.number().min(0).max(1),
      nameCorrect: z.boolean(),
      strength: z.boolean().nullable(),
      frequency: z.boolean().nullable(),
      duration: z.boolean().nullable(),
    }),
  ),
  /** Predicted lines that match no labelled line. */
  extras: z.array(
    z.object({
      predicted: z.number().int().min(0),
      confidence: z.number(),
      fabricated: z.boolean(),
    }),
  ),
});
export type EvalItemScore = z.output<typeof evalItemScoreSchema>;

/** The part of a result item the scoring reads (a `RxResultItem` fits). */
export interface PredictedLine {
  name: string | null;
  activeIngredients: readonly string[];
  strength: string | null;
  frequency: string | null;
  duration: string | null;
  confidence: number;
}

const nameKey = (text: string | null | undefined): string =>
  text === null || text === undefined ? "" : normalizeDrugName(text).name;

/** Plain Levenshtein distance; names are short, so the quadratic table is fine. */
function distance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/** 1 for equal names, 0 for nothing in common, on the normalized (lowercase, no strength, no form) names. */
export function nameSimilarity(a: string | null, b: string | null): number {
  const left = nameKey(a);
  const right = nameKey(b);
  if (left === "" || right === "") return 0;
  if (left === right) return 1;
  const longest = Math.max(Array.from(left).length, Array.from(right).length);
  return Math.max(0, 1 - distance(left, right) / longest);
}

/** The names a prediction may be read as: the drug name, then its active ingredients. */
function candidateNames(line: PredictedLine): (string | null)[] {
  return [line.name, ...line.activeIngredients];
}

function pairSimilarity(expected: EvalExpectedItem, line: PredictedLine): number {
  return Math.max(...candidateNames(line).map((name) => nameSimilarity(expected.name, name)), 0);
}

const comparable = (text: string): string =>
  normalizeArabic(text).toLowerCase().replace(/\s+/g, " ");

/** 0.5 g and 500 mg are the same strength: mass units are compared in milligrams. */
function inMilligrams(strength: Strength): { value: number; unit: string } {
  if (strength.unit === "g") return { value: strength.value * 1000, unit: "mg" };
  if (strength.unit === "mcg") return { value: strength.value / 1000, unit: "mg" };
  return { value: strength.value, unit: strength.unit };
}

function sameStrength(expected: string, predicted: string | null): boolean {
  if (predicted === null) return false;
  const left = parseStrength(expected);
  const right = parseStrength(predicted);
  if (left !== null && right !== null) {
    const a = inMilligrams(left);
    const b = inMilligrams(right);
    return (
      a.unit === b.unit &&
      strengthMicro(a.value) === strengthMicro(b.value) &&
      (left.per?.value ?? null) === (right.per?.value ?? null)
    );
  }
  return comparable(expected).replace(/\s/g, "") === comparable(predicted).replace(/\s/g, "");
}

/** Frequency and duration are compared after the same normalization the pipeline applies. */
function sameNormalized(
  normalize: (text: string | null | undefined) => string | null,
  expected: string,
  predicted: string | null,
): boolean {
  if (predicted === null) return false;
  return (
    comparable(normalize(expected) ?? expected) === comparable(normalize(predicted) ?? predicted)
  );
}

/** Scores one reading against the labelled truth. Pure and deterministic. */
export function scoreEvalItem(
  expected: EvalExpected,
  predicted: readonly PredictedLine[],
): EvalItemScore {
  // Best pairs first; ties keep the order on the paper, so the result never depends on map order.
  const candidates = expected.items.flatMap((item, e) =>
    predicted.map((line, p) => ({ e, p, similarity: pairSimilarity(item, line) })),
  );
  candidates.sort((a, b) => b.similarity - a.similarity || a.e - b.e || a.p - b.p);
  const expectedTaken = new Set<number>();
  const predictedTaken = new Map<number, number>();
  for (const { e, p, similarity } of candidates) {
    if (similarity < EVAL_DETECT_MIN_SIMILARITY) break;
    if (expectedTaken.has(e) || predictedTaken.has(p)) continue;
    expectedTaken.add(e);
    predictedTaken.set(p, e);
  }

  const fields = {
    strength: { labelled: 0, correct: 0 },
    frequency: { labelled: 0, correct: 0 },
    duration: { labelled: 0, correct: 0 },
  };
  const bands = Object.fromEntries(
    EVAL_BAND_KEYS.map((key) => [key, { total: 0, correct: 0 }]),
  ) as Record<EvalBandKey, { total: number; correct: number }>;
  const pairs: EvalItemScore["pairs"] = [];
  const correctPredicted = new Set<number>();
  let nameCorrect = 0;

  expected.items.forEach((item, e) => {
    const p = [...predictedTaken.entries()].find(([, taken]) => taken === e)?.[0];
    const line = p === undefined ? undefined : predicted[p];
    const similarity = line === undefined ? 0 : pairSimilarity(item, line);
    const correct = line !== undefined && similarity === 1;
    if (correct && p !== undefined) {
      nameCorrect++;
      correctPredicted.add(p);
    }
    const check = (
      field: "strength" | "frequency" | "duration",
      labelled: string | null,
    ): boolean | null => {
      if (labelled === null) return null;
      fields[field].labelled++;
      const ok =
        line !== undefined &&
        (field === "strength"
          ? sameStrength(labelled, line.strength)
          : field === "frequency"
            ? sameNormalized(normalizeFrequency, labelled, line.frequency)
            : sameNormalized(normalizeDuration, labelled, line.duration));
      if (ok) fields[field].correct++;
      return ok;
    };
    pairs.push({
      expected: e,
      predicted: p ?? null,
      similarity,
      nameCorrect: correct,
      strength: check("strength", item.strength),
      frequency: check("frequency", item.frequency),
      duration: check("duration", item.duration),
    });
  });

  const extras: EvalItemScore["extras"] = [];
  let fabricated = 0;
  predicted.forEach((line, p) => {
    const band = bands[bandOf(line.confidence)];
    band.total++;
    if (correctPredicted.has(p)) band.correct++;
    const isFabricated = line.confidence >= RX_BADGE_HIGH && !correctPredicted.has(p);
    if (isFabricated) fabricated++;
    if (!predictedTaken.has(p)) {
      extras.push({ predicted: p, confidence: line.confidence, fabricated: isFabricated });
    }
  });

  return {
    expected: expected.items.length,
    predicted: predicted.length,
    detected: expectedTaken.size,
    nameCorrect,
    fields,
    fabricated,
    bands,
    pairs,
    extras,
  };
}

// --- Aggregating a run ---------------------------------------------------------------------

const ratio = z.number().min(0).max(1).nullable();
const accuracy = z.object({
  labelled: z.number().int().min(0),
  correct: z.number().int().min(0),
  accuracy: ratio,
});

export const evalGroupMetricsSchema = z.object({
  /** Eval items that produced a reading, and the ones that failed (no score, counted separately). */
  items: z.number().int().min(0),
  failed: z.number().int().min(0),
  expected: z.number().int().min(0),
  predicted: z.number().int().min(0),
  detected: z.number().int().min(0),
  nameCorrect: z.number().int().min(0),
  nameAccuracy: ratio,
  recall: ratio,
  strength: accuracy,
  frequency: accuracy,
  duration: accuracy,
  fabricated: z.number().int().min(0),
  fabricationRate: ratio,
  calibration: z.array(
    z.object({
      band: z.enum(EVAL_BAND_KEYS),
      total: z.number().int().min(0),
      correct: z.number().int().min(0),
      accuracy: ratio,
    }),
  ),
  costUsdMicros: z.number().int().min(0),
  latencyP50Ms: z.number().int().min(0).nullable(),
  latencyP95Ms: z.number().int().min(0).nullable(),
});
export type EvalGroupMetrics = z.output<typeof evalGroupMetricsSchema>;

export const evalRunMetricsSchema = z.object({
  /** Overall name accuracy in percentage points (0-100, one decimal): the number routes are compared by. */
  score: z.number().min(0).max(100).nullable(),
  overall: evalGroupMetricsSchema,
  printed: evalGroupMetricsSchema,
  handwritten: evalGroupMetricsSchema,
});
export type EvalRunMetrics = z.output<typeof evalRunMetricsSchema>;

export interface ScoredEvalItem {
  kind: EvalItemKind;
  /** Null when the item failed (provider error, unreadable output). */
  score: EvalItemScore | null;
  costUsdMicros: number;
  latencyMs: number | null;
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const share = (part: number, whole: number): number | null =>
  whole === 0 ? null : round4(part / whole);

/** Nearest-rank percentile of an already sorted list. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return Math.round(sorted[rank - 1] ?? 0);
}

function aggregateGroup(items: readonly ScoredEvalItem[]): EvalGroupMetrics {
  const scored = items.flatMap((item) => (item.score === null ? [] : [item.score]));
  const sum = (pick: (score: EvalItemScore) => number): number =>
    scored.reduce((total, score) => total + pick(score), 0);
  const field = (name: "strength" | "frequency" | "duration") => {
    const labelled = sum((s) => s.fields[name].labelled);
    const correct = sum((s) => s.fields[name].correct);
    return { labelled, correct, accuracy: share(correct, labelled) };
  };
  const expected = sum((s) => s.expected);
  const predicted = sum((s) => s.predicted);
  const detected = sum((s) => s.detected);
  const nameCorrect = sum((s) => s.nameCorrect);
  const fabricated = sum((s) => s.fabricated);
  const latencies = items
    .flatMap((item) => (item.score === null || item.latencyMs === null ? [] : [item.latencyMs]))
    .sort((a, b) => a - b);
  return {
    items: scored.length,
    failed: items.length - scored.length,
    expected,
    predicted,
    detected,
    nameCorrect,
    nameAccuracy: share(nameCorrect, expected),
    recall: share(detected, expected),
    strength: field("strength"),
    frequency: field("frequency"),
    duration: field("duration"),
    fabricated,
    fabricationRate: share(fabricated, predicted),
    calibration: EVAL_BAND_KEYS.map((band) => {
      const total = sum((s) => s.bands[band]?.total ?? 0);
      const correct = sum((s) => s.bands[band]?.correct ?? 0);
      return { band, total, correct, accuracy: share(correct, total) };
    }),
    costUsdMicros: items.reduce((total, item) => total + item.costUsdMicros, 0),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

/** The run's numbers: all items, and printed / handwritten apart. */
export function aggregateEvalRun(items: readonly ScoredEvalItem[]): EvalRunMetrics {
  const overall = aggregateGroup(items);
  const accuracyPercent = overall.nameAccuracy === null ? null : overall.nameAccuracy * 100;
  return {
    score: accuracyPercent === null ? null : Math.round(accuracyPercent * 10) / 10,
    overall,
    printed: aggregateGroup(items.filter((item) => item.kind === "printed")),
    handwritten: aggregateGroup(items.filter((item) => item.kind === "handwritten")),
  };
}

/** True when `candidate` is lower than `current` by more than `EVAL_REGRESSION_POINTS`. Unknown scores never regress. */
export function isEvalRegression(current: number | null, candidate: number | null): boolean {
  return current !== null && candidate !== null && candidate < current - EVAL_REGRESSION_POINTS;
}
