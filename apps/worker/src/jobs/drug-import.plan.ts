import {
  DRUG_IMPORT_LIST_SEPARATOR,
  DRUG_IMPORT_PREVIEW_ROWS,
  DRUG_IMPORT_SAMPLE_ROWS,
  drugColumns,
  isDwaPlaceholder,
  parseBarcode,
  parseDwaTradeName,
  parsePriceMinor,
  parseUnitsCount,
  type DrugColumns,
  type DrugImportField,
  type DrugImportMapping,
  type DrugImportReason,
  type DrugImportRowStatus,
} from "@wasfa/shared/drugs";
import { normalizeDrugName, strengthMicro } from "@wasfa/shared/normalize";

import type { RawRow } from "./drug-import.file.js";
import type { DrugSource } from "@wasfa/shared/ai";
import type {
  ImportCounts,
  ImportReport,
  ImportRowResult,
} from "@wasfa/shared/schemas/admin-drugs";

/*
 * The rules of an import, free of any I/O: turn a mapped row into what the tables store, decide
 * whether it is new / updated / duplicate / invalid against what is already there, and collect the
 * report. The same code serves the dry run and the commit, so the preview never lies.
 */

const NAME_MAX = 300;
const FIELD_MAX = 200;
const LIST_MAX = 20;
const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

export interface ImportIngredient {
  nameEn: string;
  nameAr: string | null;
  normalized: string;
  strengthText: string | null;
  strengthValueMicro: number | null;
  strengthUnit: string | null;
}

export interface ImportAlias {
  alias: string;
  normalized: string;
  lang: "ar" | "en";
}

export interface ImportRow {
  row: number;
  columns: DrugColumns;
  manufacturer: string | null;
  country: string | null;
  ingredients: ImportIngredient[];
  aliases: ImportAlias[];
  /** The row's id in its source list; with the batch's source it identifies the drug on re-import. */
  sourceRef: string | null;
  /** `undefined`: the file has no such column, so an update leaves the stored value alone. */
  category: string | null | undefined;
  priceMinor: number | null | undefined;
  oldPriceMinor: number | null | undefined;
  packText: string | null | undefined;
  unitsCount: number | null | undefined;
  barcode: string | null | undefined;
}

export type RowParse =
  | { ok: true; value: ImportRow }
  | { ok: false; row: number; reason: DrugImportReason; label: string };

/** The columns of the file that feed each field (the first one mapped to it). */
export function fieldColumns(mapping: DrugImportMapping): Partial<Record<DrugImportField, string>> {
  const columns: Partial<Record<DrugImportField, string>> = {};
  for (const [header, field] of Object.entries(mapping)) columns[field] ??= header;
  return columns;
}

const orNull = (text: string, max = FIELD_MAX): string | null =>
  text === "" ? null : text.slice(0, max);

function splitList(text: string): string[] {
  return text
    .split(DRUG_IMPORT_LIST_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .slice(0, LIST_MAX);
}

function parseIngredient(piece: string): ImportIngredient | undefined {
  const parsed = normalizeDrugName(piece);
  if (parsed.name === "") return undefined;
  const hasStrength = parsed.strength !== null;
  const isArabic = ARABIC_LETTER.test(piece);
  return {
    // A name printed with its strength ("Paracetamol 500mg") is stored without it.
    nameEn: (hasStrength ? parsed.name : piece).slice(0, FIELD_MAX),
    nameAr: isArabic ? piece.slice(0, FIELD_MAX) : null,
    normalized: parsed.name,
    strengthText: hasStrength ? piece.slice(0, FIELD_MAX) : null,
    strengthValueMicro: parsed.strength === null ? null : strengthMicro(parsed.strength.value),
    strengthUnit: parsed.strength?.unit ?? null,
  };
}

/**
 * Applies the mapping to one raw row. A row without any name, or with an absurd one, is invalid.
 * For `dwaprices`, the form and pack are read out of the trade name, which carries all of them.
 */
export function parseImportRow(
  raw: RawRow,
  columns: Partial<Record<DrugImportField, string>>,
  source: DrugSource,
): RowParse {
  const cell = (field: DrugImportField): string => {
    const header = columns[field];
    return header === undefined ? "" : (raw.cells[header] ?? "").trim();
  };
  const mapped = (field: DrugImportField): boolean => columns[field] !== undefined;
  const brandEnText = cell("brandEn");
  const brandArText = cell("brandAr");
  const traded =
    source === "dwaprices" && brandEnText !== "" ? parseDwaTradeName(brandEnText) : null;
  // A list with Arabic names only still gets a row: the Arabic name doubles as the English one.
  const brandEn = traded?.brandEn ?? (brandEnText !== "" ? brandEnText : brandArText);
  if (brandEn === "") return { ok: false, row: raw.row, reason: "missing_name", label: "" };
  if (
    source === "dwaprices" &&
    isDwaPlaceholder(brandEnText, {
      ingredients: cell("ingredients"),
      category: cell("category"),
      company: cell("manufacturer"),
      barcode: cell("barcode"),
    })
  ) {
    return { ok: false, row: raw.row, reason: "placeholder", label: brandEn.slice(0, 80) };
  }
  if (brandEn.length > NAME_MAX || brandArText.length > NAME_MAX) {
    return { ok: false, row: raw.row, reason: "name_too_long", label: brandEn.slice(0, 80) };
  }

  const strength = cell("strength");
  const unit = cell("strengthUnit");
  // Two columns ("500" and "mg") are joined; a single "500 mg" cell is used as it is.
  const strengthText =
    strength !== "" && unit !== "" && !/\p{L}/u.test(strength) ? `${strength} ${unit}` : strength;
  const drug = drugColumns({
    brandEn,
    brandAr: orNull(brandArText, NAME_MAX),
    form: orNull(cell("form")) ?? traded?.form ?? null,
    strengthText: orNull(strengthText),
  });
  if (drug.normalizedEn === "") {
    return { ok: false, row: raw.row, reason: "missing_name", label: brandEn.slice(0, 80) };
  }

  const ingredients: ImportIngredient[] = [];
  for (const piece of splitList(cell("ingredients"))) {
    const ingredient = parseIngredient(piece);
    if (
      ingredient !== undefined &&
      !ingredients.some((i) => i.normalized === ingredient.normalized)
    ) {
      ingredients.push(ingredient);
    }
  }
  const aliases: ImportAlias[] = [];
  for (const alias of splitList(cell("aliases"))) {
    const normalized = normalizeDrugName(alias).name;
    const own = normalized === drug.normalizedEn || normalized === drug.normalizedAr;
    if (normalized === "" || own || aliases.some((a) => a.normalized === normalized)) continue;
    aliases.push({
      alias: alias.slice(0, NAME_MAX),
      normalized,
      lang: ARABIC_LETTER.test(alias) ? "ar" : "en",
    });
  }
  const country = cell("country").toUpperCase();
  const packText = mapped("packText") ? orNull(cell("packText")) : traded?.packText;
  return {
    ok: true,
    value: {
      row: raw.row,
      columns: drug,
      manufacturer: orNull(cell("manufacturer")),
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      ingredients,
      aliases,
      sourceRef: orNull(cell("sourceRef"), 100),
      category: mapped("category") ? orNull(cell("category")) : undefined,
      priceMinor: mapped("price") ? parsePriceMinor(cell("price")) : undefined,
      oldPriceMinor: mapped("oldPrice") ? parsePriceMinor(cell("oldPrice")) : undefined,
      packText,
      unitsCount: mapped("unitsCount") ? parseUnitsCount(cell("unitsCount")) : undefined,
      barcode: mapped("barcode") ? parseBarcode(cell("barcode")) : undefined,
    },
  };
}

/** The identity of a drug in a list: same name, strength and form is the same drug. */
export function drugKey(columns: {
  normalizedEn: string;
  strengthValueMicro: number | null;
  strengthUnit: string | null;
  form: string | null;
}): string {
  return [
    columns.normalizedEn,
    columns.strengthValueMicro ?? "",
    columns.strengthUnit ?? "",
    columns.form ?? "",
  ].join("|");
}

/** A row with a source id is identified by it; any other row by its name, strength and form. */
export const refKey = (sourceRef: string): string => `ref|${sourceRef}`;
export const rowKey = (row: ImportRow): string =>
  row.sourceRef === null ? drugKey(row.columns) : refKey(row.sourceRef);

/** What the database already holds for a drug. */
export interface ExistingDrug {
  id: string;
  brandEn: string;
  normalizedEn: string;
  brandAr: string | null;
  brandKey: string;
  form: string | null;
  strengthText: string | null;
  strengthValueMicro: number | null;
  strengthUnit: string | null;
  manufacturer: string | null;
  country: string | null;
  category: string | null;
  priceMinor: number | null;
  oldPriceMinor: number | null;
  packText: string | null;
  unitsCount: number | null;
  barcode: string | null;
  sourceRef: string | null;
  /** Set when an admin edited the row: an import never overwrites it. */
  adminEditedAt: Date | null;
  importBatchId: string | null;
  createdAt: Date;
  ingredients: ReadonlySet<string>;
  aliases: ReadonlySet<string>;
}

export interface RowPlan {
  status: DrugImportRowStatus;
  reason: DrugImportReason | null;
  /** Fields (and `ingredients`, `aliases`) an update would change. */
  changes: string[];
  /** `false` when the row is only counted: nothing to write (duplicates, rows this batch wrote before). */
  write: boolean;
  existing?: ExistingDrug;
}

export interface PlanContext {
  batchId: string;
  /** When this batch started committing: rows it wrote earlier (a retry) are not touched again. */
  committedAt: Date | null;
}

/** A value the file has (even an empty one) that is not what is stored. */
const differs = <T>(next: T | undefined, stored: T): boolean =>
  next !== undefined && next !== stored;

/**
 * Decides one row. `seen` holds the keys of the rows already decided in this file, so a repeat
 * is a duplicate; it is updated here.
 */
export function planRow(
  row: ImportRow,
  existing: ExistingDrug | undefined,
  seen: Set<string>,
  context: PlanContext,
): RowPlan {
  const key = rowKey(row);
  if (seen.has(key)) {
    return { status: "duplicate", reason: "duplicate_in_file", changes: [], write: false };
  }
  seen.add(key);
  if (existing === undefined) return { status: "new", reason: null, changes: [], write: true };

  // Written by an earlier, interrupted run of this very batch: count it as that run would have.
  if (existing.importBatchId === context.batchId) {
    const created = context.committedAt !== null && existing.createdAt >= context.committedAt;
    return {
      status: created ? "new" : "updated",
      reason: null,
      changes: [],
      write: false,
      existing,
    };
  }

  if (existing.adminEditedAt !== null) {
    return { status: "duplicate", reason: "admin_edited", changes: [], write: false, existing };
  }

  const changes: string[] = [];
  if (row.sourceRef !== null && row.sourceRef === existing.sourceRef) {
    // Found by its id, not by its name: the name, form and strength may have changed in the list.
    const c = row.columns;
    if (c.brandEn !== existing.brandEn || c.normalizedEn !== existing.normalizedEn) {
      changes.push("brandEn");
    }
    if (c.form !== existing.form) changes.push("form");
    if (
      c.strengthText !== existing.strengthText ||
      c.strengthValueMicro !== existing.strengthValueMicro ||
      c.strengthUnit !== existing.strengthUnit
    ) {
      changes.push("strength");
    }
  }
  // A row that predates `brand_key` gets it on its next import.
  if (existing.brandKey === "" && row.columns.brandKey !== "") changes.push("brandKey");
  if (differs(row.category, existing.category)) changes.push("category");
  if (differs(row.priceMinor, existing.priceMinor)) changes.push("price");
  if (differs(row.oldPriceMinor, existing.oldPriceMinor)) changes.push("oldPrice");
  if (differs(row.packText, existing.packText)) changes.push("packText");
  if (differs(row.unitsCount, existing.unitsCount)) changes.push("unitsCount");
  if (differs(row.barcode, existing.barcode)) changes.push("barcode");
  if (row.columns.brandAr !== null && row.columns.brandAr !== existing.brandAr)
    changes.push("brandAr");
  if (row.manufacturer !== null && row.manufacturer !== existing.manufacturer) {
    changes.push("manufacturer");
  }
  if (row.country !== null && row.country !== existing.country) changes.push("country");
  if (row.ingredients.some((i) => !existing.ingredients.has(i.normalized))) {
    changes.push("ingredients");
  }
  if (row.aliases.some((a) => !existing.aliases.has(a.normalized))) changes.push("aliases");
  if (changes.length === 0) {
    return { status: "duplicate", reason: "unchanged", changes, write: false, existing };
  }
  return { status: "updated", reason: null, changes, write: true, existing };
}

/** Counts, reasons and the bounded samples of a run. */
export class ReportCollector {
  readonly counts: ImportCounts = { total: 0, new: 0, updated: 0, duplicate: 0, invalid: 0 };
  private readonly reasons: Record<string, number> = {};
  private readonly preview: ImportRowResult[] = [];
  private readonly samples: Record<DrugImportRowStatus, ImportRowResult[]> = {
    new: [],
    updated: [],
    duplicate: [],
    invalid: [],
  };

  add(result: ImportRowResult): void {
    this.counts.total++;
    this.counts[result.status]++;
    if (result.reason !== null)
      this.reasons[result.reason] = (this.reasons[result.reason] ?? 0) + 1;
    if (this.preview.length < DRUG_IMPORT_PREVIEW_ROWS) this.preview.push(result);
    const sample = this.samples[result.status];
    if (sample.length < DRUG_IMPORT_SAMPLE_ROWS) sample.push(result);
  }

  build(
    mode: ImportReport["mode"],
    headers: string[],
    mapping: DrugImportMapping,
    now: Date,
  ): ImportReport {
    return {
      mode,
      generatedAt: now.toISOString(),
      headers,
      mapping,
      counts: { ...this.counts },
      reasons: { ...this.reasons },
      preview: this.preview,
      samples: this.samples,
    };
  }
}

export function rowResult(row: ImportRow, plan: RowPlan): ImportRowResult {
  return {
    row: row.row,
    status: plan.status,
    reason: plan.reason,
    brandEn: row.columns.brandEn,
    brandAr: row.columns.brandAr,
    strength: row.columns.strengthText,
    form: row.columns.form,
    ingredients: row.ingredients.map((ingredient) => ingredient.nameEn),
    changes: plan.changes,
  };
}

export function invalidResult(parse: Extract<RowParse, { ok: false }>): ImportRowResult {
  return {
    row: parse.row,
    status: "invalid",
    reason: parse.reason,
    brandEn: parse.label,
    brandAr: null,
    strength: null,
    form: null,
    ingredients: [],
    changes: [],
  };
}
