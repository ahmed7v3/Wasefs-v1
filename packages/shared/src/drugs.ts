import { normalizeArabic, normalizeDrugName, parseStrength, strengthMicro } from "./normalize.js";

import type { DrugSource } from "./ai.js";
import type { DrugForm, Strength, StrengthUnit } from "./normalize.js";

/*
 * Drug matching and import contract (Task 2.7): the thresholds are initial values, tuned on the
 * eval set later; everything that decides accept / verify / unmatched reads them from here.
 */

/** Trigram similarity a name must reach to be a candidate at all (pg_trgm's own default is 0.3). */
export const DRUG_SIMILARITY_THRESHOLD = 0.3;
/** Added when the strength in the text equals the drug's (same value and unit). */
export const DRUG_STRENGTH_BONUS = 0.1;
/** Taken off when a strength is given and the drug has strengths, none of them equal. */
export const DRUG_STRENGTH_CONFLICT_PENALTY = 0.15;
export const DRUG_FORM_BONUS = 0.05;
/** `accept` at or above this score, and only when the strength does not conflict. */
export const DRUG_MATCH_ACCEPT = 0.85;
/** `verify` from here up to `DRUG_MATCH_ACCEPT`; below it the text is `unmatched`. */
export const DRUG_MATCH_VERIFY = 0.5;
export const DRUG_MATCH_LIMIT = 5;

export type DrugMatchedOn = "brand" | "alias" | "ingredient";
export type DrugStrengthState = "match" | "conflict" | "unknown";
export type DrugFormState = "match" | "mismatch" | "unknown";
export type DrugMatchClass = "accept" | "verify" | "unmatched";

export interface DrugMatchExplanation {
  /** Best trigram similarity of the text to any name of the drug, 0-1. */
  nameScore: number;
  matchedOn: DrugMatchedOn;
  strength: DrugStrengthState;
  form: DrugFormState;
}

export interface DrugMatchCandidate {
  drugId: string;
  brandEn: string;
  brandAr: string | null;
  form: string | null;
  strengthText: string | null;
  manufacturer: string | null;
  status: "active" | "withdrawn";
  /** Final score, 0-1: name similarity plus the strength and form adjustments. */
  score: number;
  explanation: DrugMatchExplanation;
}

/** What to do with a candidate: the only place the three zones are decided. */
export function classifyMatch(
  candidate: Pick<DrugMatchCandidate, "score" | "explanation"> | undefined,
): DrugMatchClass {
  if (candidate === undefined || candidate.score < DRUG_MATCH_VERIFY) return "unmatched";
  // An ingredient-only hit is ambiguous across brands, so it is never auto-accepted.
  if (
    candidate.score >= DRUG_MATCH_ACCEPT &&
    candidate.explanation.strength !== "conflict" &&
    candidate.explanation.matchedOn !== "ingredient"
  ) {
    return "accept";
  }
  return "verify";
}

/** Fields an import can fill; the mapping is `source column header -> field`. */
export const DRUG_IMPORT_FIELDS = [
  "brandEn",
  "brandAr",
  "ingredients",
  "strength",
  "strengthUnit",
  "form",
  "manufacturer",
  "country",
  "aliases",
  "category",
  "price",
  "oldPrice",
  "packText",
  "unitsCount",
  "barcode",
  "sourceRef",
] as const;
export type DrugImportField = (typeof DRUG_IMPORT_FIELDS)[number];
export type DrugImportMapping = Record<string, DrugImportField>;

export const DRUG_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const DRUG_IMPORT_BATCH_SIZE = 1000;
export const DRUG_IMPORT_PREVIEW_ROWS = 50;
export const DRUG_IMPORT_SAMPLE_ROWS = 200;
export const DRUG_IMPORT_TTL_SECONDS = 24 * 60 * 60;
/** Splits a cell holding several ingredients or aliases. */
export const DRUG_IMPORT_LIST_SEPARATOR = /[+;|،\n]|\s\/\s|,(?![^()]*\))/;

/*
 * Column mapping presets per source (header, lowercased, to our field). The real EDA / SFDA exports
 * name their columns differently from release to release, so a preset lists the spellings seen so
 * far; headers that are absent are simply not mapped and the admin fixes the rest in the wizard.
 */
const SFDA_PRESET: DrugImportMapping = {
  // The public drugs-list export (snake_case headers): `name` is the generic name, with one entry
  // per active ingredient separated by commas, and `strength` holds one number per ingredient.
  name: "ingredients",
  "dosage form": "form",
  "trade name": "brandEn",
  tradename: "brandEn",
  "arabic trade name": "brandAr",
  "trade name ar": "brandAr",
  "scientific name": "ingredients",
  scientificname: "ingredients",
  strength: "strength",
  strengthunit: "strengthUnit",
  "strength unit": "strengthUnit",
  "pharmaceutical form": "form",
  pharmaceuticalform: "form",
  "manufacture name": "manufacturer",
  "manufacturer name": "manufacturer",
  "manufacture country": "country",
  "manufacturer country": "country",
};

const EDA_PRESET: DrugImportMapping = {
  "trade name": "brandEn",
  "brand name": "brandEn",
  "english name": "brandEn",
  "name en": "brandEn",
  "الاسم التجاري": "brandAr",
  "الاسم العربي": "brandAr",
  "arabic name": "brandAr",
  "name ar": "brandAr",
  "active ingredient": "ingredients",
  "active ingredients": "ingredients",
  "generic name": "ingredients",
  "المادة الفعالة": "ingredients",
  concentration: "strength",
  strength: "strength",
  التركيز: "strength",
  form: "form",
  "dosage form": "form",
  "الشكل الصيدلي": "form",
  company: "manufacturer",
  manufacturer: "manufacturer",
  الشركة: "manufacturer",
  country: "country",
  aliases: "aliases",
};

// dwaprices.com JSON export (docs/MEDICATIONS.md §2). `trade_name_ar` is English + "price in Egypt"
// and `details_url` is a link: neither is mapped. `trade_name_en` holds brand, strength, form and pack
// together; the import parses it (see `parseDwaTradeName`).
const DWA_PRESET: DrugImportMapping = {
  trade_name_en: "brandEn",
  active_ingredient: "ingredients",
  concentration: "strength",
  category: "category",
  company: "manufacturer",
  current_price: "price",
  old_price: "oldPrice",
  units_count: "unitsCount",
  barcode: "barcode",
  id: "sourceRef",
};

export const DRUG_IMPORT_PRESETS: Readonly<Record<DrugSource, DrugImportMapping>> = {
  sfda: SFDA_PRESET,
  eda: EDA_PRESET,
  dwaprices: DWA_PRESET,
  // Our own export names: the plain field names.
  manual: Object.fromEntries(DRUG_IMPORT_FIELDS.map((field) => [field.toLowerCase(), field])),
  other: Object.fromEntries(DRUG_IMPORT_FIELDS.map((field) => [field.toLowerCase(), field])),
};

/** `trade_name`, `Trade Name` and ` trade  name ` are the same header. */
const headerKey = (header: string): string =>
  normalizeArabic(header)
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();

/**
 * The preset's mapping for the headers a file really has (matched ignoring case, spaces at the
 * ends and Arabic spelling variants). A field is given to the first header that claims it.
 */
export function presetMapping(source: DrugSource, headers: readonly string[]): DrugImportMapping {
  const preset = new Map<string, DrugImportField>(
    Object.entries(DRUG_IMPORT_PRESETS[source]).map(([header, field]) => [
      headerKey(header),
      field,
    ]),
  );
  const mapping: DrugImportMapping = {};
  const taken = new Set<DrugImportField>();
  for (const header of headers) {
    const field = preset.get(headerKey(header));
    if (field === undefined || taken.has(field)) continue;
    mapping[header] = field;
    taken.add(field);
  }
  return mapping;
}

/** Closed set of reasons a row is `invalid`, `duplicate` or listed under `updated` changes. */
export const DRUG_IMPORT_ROW_STATUSES = ["new", "updated", "duplicate", "invalid"] as const;
export type DrugImportRowStatus = (typeof DRUG_IMPORT_ROW_STATUSES)[number];

export const DRUG_IMPORT_REASONS = [
  "missing_name",
  "name_too_long",
  "duplicate_in_file",
  "unchanged",
  // The row was edited by an admin: a re-import never overwrites it (docs/MEDICATIONS.md §2).
  "admin_edited",
  // A dwaprices filler entry ("Aaa-6515"): a made-up name with no data at all.
  "placeholder",
] as const;
export type DrugImportReason = (typeof DRUG_IMPORT_REASONS)[number];

/** Review states of a reading nobody could match (`drug_unmatched_names.status`). */
export const DRUG_UNMATCHED_STATUSES = ["open", "mapped", "ignored"] as const;
export type DrugUnmatchedStatus = (typeof DRUG_UNMATCHED_STATUSES)[number];

/** States of a user-voted alias (`drug_learned.status`). */
export const DRUG_LEARNED_STATUSES = ["pending", "approved", "rejected"] as const;
export type DrugLearnedStatus = (typeof DRUG_LEARNED_STATUSES)[number];

/*
 * Brand family and pack parsing. Lists such as dwaprices.com write brand, strength, form and pack in
 * one name ("Flumox 1000mg 15 f.c. tabs"); `brand_key` is the family ("flumox") that every
 * strength/pack of the brand shares, which is what recognition compares and chat cards look up.
 */

/** Pack and route words that end a brand family ("15 f.c. tabs", "30 sachets", "i.v."). */
const PACK_WORDS: ReadonlySet<string> = new Set([
  "f.c",
  "fc",
  "e.c",
  "ec",
  "i.v",
  "iv",
  "i.m",
  "im",
  "s.c",
  "sc",
  "film",
  "films",
  "patch",
  "patches",
  "lozenge",
  "lozenges",
  "strip",
  "strips",
  "pc",
  "pcs",
  "piece",
  "pieces",
  "bottle",
  "bottles",
  "box",
  "pack",
  "packs",
  "tube",
  "tubes",
  "ampoules",
  "vials",
  "sachets",
  "suppositories",
  "enema",
  "oral",
  "dispersible",
  "chewable",
  "sublingual",
]);
/** Quantity units that make "120 ml" or "907 gm" a pack size (a strength comes from its own column). */
const PACK_UNITS: ReadonlySet<string> = new Set(["ml", "l", "g", "gm", "kg", "oz"]);

/**
 * Parenthesized text dropped (also an unclosed "(illegal import"), and glued dotted abbreviations
 * split ("f.c.tabs" -> "f.c. tabs") so the form word is seen.
 */
function prepareBrandName(text: string): string {
  return text
    .replace(/\([^)]*(?:\)|$)/g, " ")
    .replace(/\b([a-z])\.([a-z])\.(?=[a-z])/gi, "$1.$2. ");
}

/** Index of the token where the trailing pack part starts ("15 f.c. tabs", "120 ml"), or -1. */
function packStart(tokens: readonly string[]): number {
  const last = tokens.findLastIndex((token) => /^\d/.test(token));
  if (last <= 0) return -1;
  const match = /^(\d+(?:[.,]\d+)?)([a-z.]*)$/i.exec(tokens[last] ?? "");
  if (match === null) return -1;
  const unit = (match[2] || tokens[last + 1] || "").toLowerCase().replace(/\.+$/, "");
  if (unit === "") return -1;
  const isPack =
    PACK_UNITS.has(unit) || PACK_WORDS.has(unit) || normalizeDrugName(unit).form !== null;
  return isPack ? last : -1;
}

/**
 * The trailing pack part of a name ("15 f.c. tabs", "120 ml", "30 sachets"), or `null` when the
 * name ends without one (a trailing "500 mg" is a strength, not a pack).
 */
export function drugPackText(brandEn: string): string | null {
  const tokens = prepareBrandName(brandEn).split(/\s+/).filter(Boolean);
  const start = packStart(tokens);
  return start < 0 ? null : tokens.slice(start).join(" ").slice(0, 100);
}

/**
 * The brand family of a name: the normalized name up to the first number, strength, pack or form
 * word, lowercase, spaces collapsed ("Actifed expectorant syrup 120 ml" -> "actifed expectorant").
 * The first word is always kept (so the key is empty only for an empty name), and numbers at the very
 * start belong to the name ("1 2 3 (one two three) syrup 120 ml" -> "1 2 3", "5-fluorouracil-ebewe
 * 250mg/5ml i.v. vial" -> "5 fluorouracil ebewe"); the pack count after them is cut first, so
 * "... 20 f.c.tabs" does not end up in the key.
 */
export function brandKeyOf(brandEn: string): string {
  const words = prepareBrandName(brandEn).split(/\s+/).filter(Boolean);
  const start = packStart(words);
  const withoutPack = (start < 0 ? words : words.slice(0, start)).join(" ");
  const tokens = normalizeDrugName(withoutPack).name.split(" ").filter(Boolean);
  let end = tokens.length;
  let leading = true;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const numeric = /^\d/.test(token);
    if (leading && numeric) continue;
    if (i > 0 && (numeric || PACK_WORDS.has(token))) {
      end = i;
      break;
    }
    leading = false;
  }
  return tokens.slice(0, end).join(" ").slice(0, 200);
}

/** What `trade_name_en` of a dwaprices row yields: the full name, its form and its pack. */
export function parseDwaTradeName(text: string): {
  brandEn: string;
  form: DrugForm | null;
  packText: string | null;
} {
  const brandEn = text.trim().replace(/\s+/g, " ");
  return {
    brandEn,
    form: normalizeDrugName(prepareBrandName(brandEn)).form,
    packText: drugPackText(brandEn),
  };
}

/**
 * dwaprices lists filler entries named like "Aaa-6515". They are rejected only when they also carry
 * no ingredient, category, company or barcode, so a real product with such a name survives.
 */
export function isDwaPlaceholder(
  tradeName: string,
  data: { ingredients: string; category: string; company: string; barcode: string },
): boolean {
  return (
    /^[A-Za-z]{2,5}-\d+$/.test(tradeName.trim()) &&
    data.ingredients.trim() === "" &&
    data.category.trim() === "" &&
    data.company.trim() === "" &&
    data.barcode.trim() === ""
  );
}

/** Prices arrive as decimal currency ("40", "12.5"); stored as integer minor units, 0 or junk = none. */
export function parsePriceMinor(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const minor = Math.round(Number(trimmed) * 100);
  // Inside Postgres' integer range; 0 means "no price" in the lists.
  return minor > 0 && minor <= 2_000_000_000 ? minor : null;
}

/** Digits only, 8-14 of them; a code written twice ("62210000032956221000003295") is kept once. */
export function parseBarcode(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  const half = digits.length / 2;
  const code =
    digits.length % 2 === 0 && digits.slice(0, half) === digits.slice(half)
      ? digits.slice(0, half)
      : digits;
  return code.length >= 8 && code.length <= 14 ? code : null;
}

/** A pack count: a positive integer, else `null`. */
export function parseUnitsCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return count > 0 && count <= 1_000_000 ? count : null;
}

/** What the `drugs` table stores for one drug, computed from the text an admin or a list gives. */
export interface DrugColumns {
  brandEn: string;
  brandAr: string | null;
  normalizedEn: string;
  normalizedAr: string | null;
  /** The brand family, see `brandKeyOf`. */
  brandKey: string;
  form: string | null;
  strengthText: string | null;
  strengthValueMicro: number | null;
  strengthUnit: StrengthUnit | null;
}

export interface DrugColumnsInput {
  brandEn: string;
  brandAr?: string | null | undefined;
  form?: string | null | undefined;
  strengthText?: string | null | undefined;
}

const strengthLabel = (strength: Strength): string =>
  `${strength.value} ${strength.unit}${strength.per === undefined ? "" : `/${strength.per.value} ${strength.per.unit}`}`;

const clean = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text.replace(/\s+/g, " ");
};

/**
 * The one place a drug's searchable columns are derived, for imports and for admin edits, so a name
 * is always stored in the same shape the matcher looks it up in. A strength or dosage form that is
 * printed inside the brand name ("Panadol 500mg Tabs") is used when no separate value is given;
 * `normalized_en` never contains either.
 */
export function drugColumns(input: DrugColumnsInput): DrugColumns {
  const brandEn = clean(input.brandEn) ?? "";
  const brandAr = clean(input.brandAr);
  const name = normalizeDrugName(brandEn);
  const arabic = brandAr === null ? null : normalizeDrugName(brandAr);

  const formText = clean(input.form);
  const form =
    formText === null ? name.form : (normalizeDrugName(formText).form ?? formText.toLowerCase());

  const givenStrength = clean(input.strengthText);
  const strength = givenStrength === null ? name.strength : parseStrength(givenStrength);
  const strengthText = givenStrength ?? (strength === null ? null : strengthLabel(strength));

  return {
    brandEn,
    brandAr,
    normalizedEn: name.name,
    normalizedAr: arabic === null || arabic.name === "" ? null : arabic.name,
    brandKey: brandKeyOf(brandEn),
    form,
    strengthText,
    strengthValueMicro: strength === null ? null : strengthMicro(strength.value),
    strengthUnit: strength?.unit ?? null,
  };
}

/*
 * Where an import lives in Redis while it runs. The api writes the uploaded file and reads progress
 * and report; the worker reads the file and writes progress and report. All keys expire after
 * `DRUG_IMPORT_TTL_SECONDS`, so an abandoned upload cleans itself up.
 */
export function drugImportKeys(batchId: string) {
  const base = `drugimport:${batchId}`;
  return {
    file: base,
    progress: `${base}:progress`,
    report: `${base}:report`,
    /** Set while a job for this batch is queued or running; it keeps two jobs from overlapping. */
    busy: `${base}:busy`,
  } as const;
}

/** A busy flag outlives a crashed worker by at most this long. */
export const DRUG_IMPORT_BUSY_SECONDS = 60 * 60;
