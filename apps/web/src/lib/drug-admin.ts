import { DRUG_IMPORT_FIELDS, presetMapping } from "@wasfa/shared/drugs";
import { t } from "@wasfa/shared/i18n";
import {
  createDrugSchema,
  updateDrugSchema,
  type DrugView,
  type ImportProgress,
} from "@wasfa/shared/schemas/admin-drugs";

import { describeIssue } from "./forms";

import type { DrugImportStatus, DrugSource } from "@wasfa/shared/ai";
import type { DrugImportField, DrugMatchClass } from "@wasfa/shared/drugs";
import type { BadgeTone } from "@wasfa/ui";

/** How often a running import is re-read. */
export const IMPORT_POLL_MS = 1_500;

/** A job is still going: queued behind another, or reading and writing rows. */
export function isRunning(progress: ImportProgress | null): boolean {
  return progress !== null && (progress.phase === "queued" || progress.phase === "running");
}

/** 0-100 for the progress bar; a job that has not counted its rows yet shows 0. */
export function progressPercent(progress: ImportProgress): number {
  if (progress.phase === "done") return 100;
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.floor((progress.done / progress.total) * 100));
}

export const MATCH_TONES: Record<DrugMatchClass, BadgeTone> = {
  accept: "success",
  verify: "warning",
  unmatched: "neutral",
};

export const IMPORT_STATUS_TONES: Record<DrugImportStatus, BadgeTone> = {
  draft: "neutral",
  dry_run: "info",
  committed: "success",
  rolled_back: "warning",
  failed: "danger",
};

/** A score 0-1 as a whole percent. */
export const scorePercent = (score: number): string => String(Math.round(score * 100));

/** Fields the mapping can fill, in the order the wizard offers them. */
export const MAPPING_FIELDS: readonly DrugImportField[] = DRUG_IMPORT_FIELDS;

/** `{ column: field }` with `""` for ignored columns, the shape of the wizard's selects. */
export type MappingDraft = Record<string, DrugImportField | "">;

export function draftFrom(
  headers: readonly string[],
  mapping: Readonly<Record<string, DrugImportField>>,
): MappingDraft {
  return Object.fromEntries(headers.map((header) => [header, mapping[header] ?? ""]));
}

export function presetDraft(source: DrugSource, headers: readonly string[]): MappingDraft {
  return draftFrom(headers, presetMapping(source, headers));
}

/** The mapping to send: only the columns that go somewhere. */
export function mappingFrom(draft: MappingDraft): Record<string, DrugImportField> {
  const mapping: Record<string, DrugImportField> = {};
  for (const [header, field] of Object.entries(draft)) {
    if (field !== "") mapping[header] = field;
  }
  return mapping;
}

/** Fields claimed by more than one column: the API refuses these, the wizard says so first. */
export function duplicateFields(draft: MappingDraft): DrugImportField[] {
  const seen = new Set<DrugImportField>();
  const duplicates = new Set<DrugImportField>();
  for (const field of Object.values(draft)) {
    if (field === "") continue;
    if (seen.has(field)) duplicates.add(field);
    seen.add(field);
  }
  return [...duplicates];
}

/** True when the wizard's mapping equals the one the last dry run used. */
export function sameMapping(
  draft: MappingDraft,
  used: Readonly<Record<string, DrugImportField>>,
): boolean {
  const next = mappingFrom(draft);
  const a = Object.keys(next);
  return (
    a.length === Object.keys(used).length && a.every((header) => next[header] === used[header])
  );
}

// --- Entry form: prices are typed in pounds and stored as integer piastres (AGENT 5.5) ---

/**
 * "12.5" → 1250. `null` for an empty box, `undefined` for text that is not an amount with at most
 * two decimals. Parsed from the digits, never through a float, so 19.99 is exactly 1999.
 */
export function minorFromText(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 1250 → "12.50"; `null` → "". */
export function textFromMinor(minor: number | null): string {
  if (minor === null) return "";
  return `${String(Math.floor(minor / 100))}.${String(minor % 100).padStart(2, "0")}`;
}

/** Most ingredients one entry holds (the API's limit). */
export const INGREDIENTS_MAX = 12;

export interface IngredientRow {
  key: number;
  name: string;
  strength: string;
}

export interface DrugDraft {
  brandEn: string;
  brandAr: string;
  form: string;
  strengthText: string;
  manufacturer: string;
  country: string;
  category: string;
  packText: string;
  unitsCount: string;
  barcode: string;
  price: string;
  oldPrice: string;
  currency: string;
  status: DrugView["status"];
  ingredients: IngredientRow[];
}

let rowCounter = 0;
export const newIngredientRow = (name = "", strength = ""): IngredientRow => ({
  key: ++rowCounter,
  name,
  strength,
});

/** The form's starting values: the entry being edited, or an empty one (optionally with a brand name). */
export function draftFromDrug(drug: DrugView | null, brandEn = ""): DrugDraft {
  return {
    brandEn: drug?.brandEn ?? brandEn,
    brandAr: drug?.brandAr ?? "",
    form: drug?.form ?? "",
    strengthText: drug?.strengthText ?? "",
    manufacturer: drug?.manufacturer ?? "",
    country: drug?.country ?? "",
    category: drug?.category ?? "",
    packText: drug?.packText ?? "",
    unitsCount: drug === null || drug.unitsCount === null ? "" : String(drug.unitsCount),
    barcode: drug?.barcode ?? "",
    price: textFromMinor(drug?.priceMinor ?? null),
    oldPrice: textFromMinor(drug?.oldPriceMinor ?? null),
    currency: drug?.currency ?? "EGP",
    status: drug?.status ?? "active",
    ingredients: (drug?.ingredients ?? []).map((ingredient) =>
      newIngredientRow(ingredient.nameEn, ingredient.strengthText ?? ""),
    ),
  };
}

export type DrugPayloadResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; errors: Record<string, string> };

const optionalText = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/**
 * The request body of a save, checked with the shared create / update schema. Editing sends only what
 * changed (`data: null` when nothing did) and an emptied optional box clears the field; creating
 * leaves the empty boxes out.
 */
export function buildDrugPayload(draft: DrugDraft, original: DrugView | null): DrugPayloadResult {
  const errors: Record<string, string> = {};
  const priceMinor = minorFromText(draft.price);
  const oldPriceMinor = minorFromText(draft.oldPrice);
  if (priceMinor === undefined) errors["priceMinor"] = t("admin.drugs.form.priceInvalid");
  if (oldPriceMinor === undefined) errors["oldPriceMinor"] = t("admin.drugs.form.priceInvalid");
  const unitsText = draft.unitsCount.trim();
  const unitsCount =
    unitsText === "" ? null : /^\d{1,9}$/.test(unitsText) ? Number(unitsText) : undefined;
  if (unitsCount === undefined) errors["unitsCount"] = t("admin.drugs.form.unitsInvalid");
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const ingredients = draft.ingredients
    .filter((row) => row.name.trim() !== "" || row.strength.trim() !== "")
    .map((row) => ({ name: row.name.trim(), strength: optionalText(row.strength) }));
  const next: Record<string, unknown> = {
    brandEn: draft.brandEn.trim(),
    brandAr: optionalText(draft.brandAr),
    form: optionalText(draft.form),
    strengthText: optionalText(draft.strengthText),
    manufacturer: optionalText(draft.manufacturer),
    country: optionalText(draft.country),
    category: optionalText(draft.category),
    packText: optionalText(draft.packText),
    unitsCount: unitsCount ?? null,
    barcode: optionalText(draft.barcode),
    priceMinor: priceMinor ?? null,
    oldPriceMinor: oldPriceMinor ?? null,
    currency: draft.currency.trim(),
  };

  let body: Record<string, unknown> = {};
  if (original === null) {
    for (const [name, value] of Object.entries(next)) {
      if (value !== null && value !== "") body[name] = value;
    }
    if (ingredients.length > 0) body["ingredients"] = ingredients;
  } else {
    body = Object.fromEntries(
      Object.entries({ status: draft.status, ...next }).filter(
        ([name, value]) => value !== original[name as keyof DrugView],
      ),
    );
    const before = original.ingredients.map((row) => ({
      name: row.nameEn,
      strength: row.strengthText,
    }));
    if (JSON.stringify(before) !== JSON.stringify(ingredients)) body["ingredients"] = ingredients;
    if (Object.keys(body).length === 0) return { ok: true, data: null };
  }

  const parsed = (original === null ? createDrugSchema : updateDrugSchema).safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string") {
      errors[field] ??= describeIssue(issue, body[field]);
    }
  }
  return { ok: false, errors };
}

/** "42.50 EGP" for a price in minor units. */
export function formatMinor(minor: number, currency: string): string {
  return `${textFromMinor(minor)} ${currency}`;
}
