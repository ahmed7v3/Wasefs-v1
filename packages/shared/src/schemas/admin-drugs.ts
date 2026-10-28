import { z } from "zod";

import { DRUG_ALIAS_LANGS, DRUG_IMPORT_STATUSES, DRUG_SOURCES, DRUG_STATUSES } from "../ai.js";
import { DECISION_REASONS } from "../drug-decision.js";
import {
  DRUG_IMPORT_FIELDS,
  DRUG_IMPORT_ROW_STATUSES,
  DRUG_LEARNED_STATUSES,
  DRUG_MATCH_LIMIT,
  DRUG_UNMATCHED_STATUSES,
} from "../drugs.js";
import { COUNTRY_CODE_PATTERN } from "../identity.js";
import { RX_LEGIBILITIES } from "../rx.js";

/*
 * Admin drug database contract (Phase 2, Task 2.7): browse and edit drugs, aliases, merge, and the
 * import wizard (upload, dry run, commit, rollback). Strengths are edited as text ("500 mg"); the
 * api parses them into the integer micros and unit the database stores.
 */

const isoDate = z.iso.datetime({ offset: true });
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const adminDrugParamSchema = z.object({ id: z.uuid() });

// --- Browse and edit ---

export const DRUG_SEARCH_MAX = 50;

/** What a catalog audit can look for: entries without an ingredient, a price or a category. */
export const DRUG_MISSING_FIELDS = ["ingredient", "price", "category"] as const;

const queryFlag = z.enum(["true", "false"]).transform((value) => value === "true");

export const drugSearchQuerySchema = z.object({
  /** Free text; without it the drugs are listed by brand name, a page at a time. */
  q: z.string().trim().max(200).optional(),
  /** Passed to the matcher as the strength / form found elsewhere (e.g. "500 mg", "tablet"). */
  strength: z.string().trim().max(60).optional(),
  form: z.string().trim().max(60).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DRUG_SEARCH_MAX)
    .default(DRUG_MATCH_LIMIT * 4),
  // Filters. They narrow both the plain list and the matcher's candidates.
  category: z.string().trim().min(1).max(100).optional(),
  manufacturer: z.string().trim().min(1).max(200).optional(),
  missing: z.enum(DRUG_MISSING_FIELDS).optional(),
  status: z.enum(DRUG_STATUSES).optional(),
  /** `true`: only entries an admin edited; `false`: only untouched ones. */
  edited: queryFlag.optional(),
  /** `nextCursor` of the previous page (plain list only; a text search is one page). */
  cursor: z.string().trim().min(1).max(40).optional(),
});

export type DrugSearchQuery = z.output<typeof drugSearchQuerySchema>;

export const drugIngredientViewSchema = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  strengthText: z.string().nullable(),
});

export const drugAliasViewSchema = z.object({
  id: z.uuid(),
  alias: z.string(),
  lang: z.enum(DRUG_ALIAS_LANGS),
  source: z.string().nullable(),
});

export const drugViewSchema = z.object({
  id: z.uuid(),
  brandEn: z.string(),
  brandAr: z.string().nullable(),
  form: z.string().nullable(),
  strengthText: z.string().nullable(),
  strengthValueMicro: z.number().int().nullable(),
  strengthUnit: z.string().nullable(),
  manufacturer: z.string().nullable(),
  country: z.string().nullable(),
  status: z.enum(DRUG_STATUSES),
  importBatchId: z.uuid().nullable(),
  category: z.string().nullable(),
  packText: z.string().nullable(),
  unitsCount: z.number().int().nullable(),
  barcode: z.string().nullable(),
  priceMinor: z.number().int().nullable(),
  oldPriceMinor: z.number().int().nullable(),
  currency: z.string(),
  brandKey: z.string(),
  source: z.string().nullable(),
  priceUpdatedAt: isoDate.nullable(),
  /** Set once an admin edited the entry: a re-import leaves it alone. */
  adminEditedAt: isoDate.nullable(),
  ingredients: z.array(drugIngredientViewSchema),
  aliases: z.array(drugAliasViewSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type DrugView = z.infer<typeof drugViewSchema>;

const matchExplanationSchema = z.object({
  nameScore: z.number(),
  matchedOn: z.enum(["brand", "alias", "ingredient", "alias_exact"]),
  strength: z.enum(["match", "conflict", "unknown"]),
  form: z.enum(["match", "mismatch", "unknown"]),
});

export const drugSearchItemSchema = drugViewSchema.extend({
  /** Present when the list is a text search. */
  match: z
    .object({
      score: z.number(),
      class: z.enum(["accept", "verify", "unmatched"]),
      explanation: matchExplanationSchema,
    })
    .nullable(),
});
export type DrugSearchItem = z.infer<typeof drugSearchItemSchema>;

export const drugSearchResponseSchema = z.object({
  items: z.array(drugSearchItemSchema),
  nextCursor: z.string().nullable(),
});

/** An ingredient as typed by an admin; it is found or created by its normalized name. */
export const drugIngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  strength: nullableText(100).optional(),
});
export type DrugIngredientInput = z.infer<typeof drugIngredientInputSchema>;

const drugIngredientsInput = z.array(drugIngredientInputSchema).max(12);
// Stored as integer minor units (AGENT 5.5): piastres for EGP.
const minorUnits = z.number().int().min(0).max(2_000_000_000).nullable();

/** The editable fields of an entry besides the names; shared by create and update. */
const drugFieldShape = {
  brandAr: nullableText(300),
  form: nullableText(60),
  strengthText: nullableText(100),
  manufacturer: nullableText(200),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => COUNTRY_CODE_PATTERN.test(value), "must be an ISO 3166-1 alpha-2 code")
    .nullable(),
  category: nullableText(100),
  packText: nullableText(100),
  unitsCount: z.number().int().min(1).max(1_000_000).nullable(),
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, "must be 8 to 14 digits")
    .nullable(),
  priceMinor: minorUnits,
  oldPriceMinor: minorUnits,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "must be an ISO 4217 code"),
};

/** A new entry: the brand name is required, everything else optional (`source` is `manual`). */
export const createDrugSchema = z
  .object({
    brandEn: z.string().trim().min(1).max(300),
    ...drugFieldShape,
    ingredients: drugIngredientsInput,
  })
  .partial()
  .required({ brandEn: true });
export type CreateDrugInput = z.infer<typeof createDrugSchema>;

export const updateDrugSchema = z
  .object({
    brandEn: z.string().trim().min(1).max(300),
    ...drugFieldShape,
    status: z.enum(DRUG_STATUSES),
    /** Replaces the entry's whole ingredient list. */
    ingredients: drugIngredientsInput,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "at least one field");
export type UpdateDrugInput = z.infer<typeof updateDrugSchema>;

export const setDrugStatusSchema = z.object({ status: z.enum(DRUG_STATUSES) });
export type SetDrugStatusInput = z.infer<typeof setDrugStatusSchema>;

export const deleteDrugResponseSchema = z.object({ deleted: z.literal(true) });

export const drugCategoriesResponseSchema = z.object({
  items: z.array(z.object({ category: z.string(), count: z.number().int() })),
});

// --- Review queues (docs/MEDICATIONS.md section 7) ---

const reading = z.string().trim().min(1).max(120);
const QUEUE_PAGE_MAX = 100;

/** The `:normalized` path parameter (Fastify has already URL-decoded it). */
export const unmatchedParamSchema = z.object({ normalized: reading });

export const unmatchedQuerySchema = z.object({
  status: z.enum(DRUG_UNMATCHED_STATUSES).default("open"),
  cursor: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(QUEUE_PAGE_MAX).default(50),
});
export type UnmatchedQuery = z.output<typeof unmatchedQuerySchema>;

export const unmatchedItemSchema = z.object({
  normalized: z.string(),
  sample: z.string(),
  hits: z.number().int(),
  firstSeen: isoDate,
  lastSeen: isoDate,
  status: z.enum(DRUG_UNMATCHED_STATUSES),
  mappedDrugId: z.uuid().nullable(),
  mappedBrandEn: z.string().nullable(),
});
export type UnmatchedItem = z.infer<typeof unmatchedItemSchema>;

export const unmatchedListResponseSchema = z.object({
  items: z.array(unmatchedItemSchema),
  nextCursor: z.string().nullable(),
});

export const mapUnmatchedSchema = z.object({ drugId: z.uuid() });
export type MapUnmatchedInput = z.infer<typeof mapUnmatchedSchema>;

export const learnedQuerySchema = z.object({
  status: z.enum(DRUG_LEARNED_STATUSES).default("pending"),
  cursor: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(QUEUE_PAGE_MAX).default(50),
});
export type LearnedQuery = z.output<typeof learnedQuerySchema>;

export const learnedItemSchema = z.object({
  normalized: z.string(),
  drugId: z.uuid(),
  brandEn: z.string(),
  strengthText: z.string().nullable(),
  form: z.string().nullable(),
  votes: z.number().int(),
  status: z.enum(DRUG_LEARNED_STATUSES),
  decidedAt: isoDate.nullable(),
});
export type LearnedItem = z.infer<typeof learnedItemSchema>;

export const learnedListResponseSchema = z.object({
  items: z.array(learnedItemSchema),
  nextCursor: z.string().nullable(),
});

/** Approve or reject one learned pair. */
export const learnedDecisionSchema = z.object({ normalized: reading, drugId: z.uuid() });
export type LearnedDecisionInput = z.infer<typeof learnedDecisionSchema>;

export const queueActionResponseSchema = z.object({ ok: z.literal(true) });

export const addAliasSchema = z.object({
  alias: z.string().trim().min(1).max(300),
  /** Detected from the script when omitted. */
  lang: z.enum(DRUG_ALIAS_LANGS).optional(),
});
export type AddAliasInput = z.infer<typeof addAliasSchema>;

export const mergeDrugsSchema = z
  .object({ keepId: z.uuid(), mergeId: z.uuid() })
  .refine((body) => body.keepId !== body.mergeId, "must be two different drugs");
export type MergeDrugsInput = z.infer<typeof mergeDrugsSchema>;

export const mergeDrugsResponseSchema = z.object({
  kept: drugViewSchema,
  movedAliases: z.number().int(),
  movedIngredients: z.number().int(),
});

// --- Recognition sandbox (docs/MEDICATIONS.md section 7) ---

/** "What would the engine do with this name?": the same input a prescription line gives the matcher. */
export const drugSandboxQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  strength: z.string().trim().max(60).optional(),
  form: z.string().trim().max(60).optional(),
  legibility: z.enum(RX_LEGIBILITIES).default("clear"),
});
export type DrugSandboxQuery = z.output<typeof drugSandboxQuerySchema>;

export const drugSandboxCandidateSchema = z.object({
  drugId: z.uuid(),
  brandEn: z.string(),
  brandAr: z.string().nullable(),
  brandKey: z.string(),
  strengthText: z.string().nullable(),
  form: z.string().nullable(),
  score: z.number(),
  explanation: matchExplanationSchema,
});

export const drugSandboxResponseSchema = z.object({
  settings: z.object({
    acceptScore: z.number(),
    reviewScore: z.number(),
    minMargin: z.number(),
    enabled: z.boolean(),
    mode: z.enum(["hybrid", "ai_only"]),
  }),
  candidates: z.array(drugSandboxCandidateSchema),
  decision: z.object({
    matchClass: z.enum(["accept", "verify", "unmatched"]),
    chosenDrugId: z.uuid().nullable(),
    familyOnly: z.boolean(),
    reason: z.enum(DECISION_REASONS),
  }),
});
export type DrugSandboxResponse = z.infer<typeof drugSandboxResponseSchema>;

// --- Import wizard ---

export const importMappingSchema = z
  .record(z.string().min(1).max(200), z.enum(DRUG_IMPORT_FIELDS))
  .refine((mapping) => Object.keys(mapping).length <= 100, "too many columns")
  .refine((mapping) => {
    const fields = Object.values(mapping);
    return new Set(fields).size === fields.length;
  }, "each field can be filled by one column only");
export type ImportMappingInput = z.infer<typeof importMappingSchema>;

/** Text parts of the multipart upload (the file part is read separately). */
export const createImportFieldsSchema = z.object({
  source: z.enum(DRUG_SOURCES),
  /** JSON text of `importMappingSchema`; the source's preset when omitted. */
  mapping: z
    .string()
    .max(20_000)
    .optional()
    .transform((text, ctx) => {
      if (text === undefined || text.trim() === "") return undefined;
      try {
        return importMappingSchema.parse(JSON.parse(text));
      } catch {
        ctx.addIssue({ code: "custom", message: "must be a valid column mapping" });
        return z.NEVER;
      }
    }),
});

/** Dry runs may bring a corrected mapping. */
export const dryRunSchema = z.object({ mapping: importMappingSchema.optional() });
export type DryRunInput = z.infer<typeof dryRunSchema>;

export const importRowResultSchema = z.object({
  row: z.number().int(),
  status: z.enum(DRUG_IMPORT_ROW_STATUSES),
  reason: z.string().nullable(),
  brandEn: z.string(),
  brandAr: z.string().nullable(),
  strength: z.string().nullable(),
  form: z.string().nullable(),
  ingredients: z.array(z.string()),
  /** For `updated`: which fields would change. */
  changes: z.array(z.string()),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importCountsSchema = z.object({
  total: z.number().int(),
  new: z.number().int(),
  updated: z.number().int(),
  duplicate: z.number().int(),
  invalid: z.number().int(),
});
export type ImportCounts = z.infer<typeof importCountsSchema>;

export const importReportSchema = z.object({
  mode: z.enum(["dry_run", "commit"]),
  generatedAt: isoDate,
  headers: z.array(z.string()),
  mapping: z.record(z.string(), z.enum(DRUG_IMPORT_FIELDS)),
  counts: importCountsSchema,
  /** Rows per reason (`missing_name`, `duplicate_in_file`, `unchanged`, ...). */
  reasons: z.record(z.string(), z.number().int()),
  /** The first rows of the file with what would happen to each. */
  preview: z.array(importRowResultSchema),
  /** Up to 200 rows per status for the diff view. */
  samples: z.object({
    new: z.array(importRowResultSchema),
    updated: z.array(importRowResultSchema),
    duplicate: z.array(importRowResultSchema),
    invalid: z.array(importRowResultSchema),
  }),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const IMPORT_PHASES = ["queued", "running", "done", "failed"] as const;

export const importProgressSchema = z.object({
  mode: z.enum(["dry_run", "commit"]),
  phase: z.enum(IMPORT_PHASES),
  done: z.number().int(),
  total: z.number().int(),
  /** Stable code of a failure (`file_unreadable`, `no_rows`, `internal`); never a message. */
  error: z.string().nullable(),
});
export type ImportProgress = z.infer<typeof importProgressSchema>;

export const importViewSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  source: z.enum(DRUG_SOURCES),
  mapping: z.record(z.string(), z.enum(DRUG_IMPORT_FIELDS)),
  status: z.enum(DRUG_IMPORT_STATUSES),
  rowsTotal: z.number().int(),
  rowsInserted: z.number().int(),
  rowsUpdated: z.number().int(),
  rowsSkipped: z.number().int(),
  committedAt: isoDate.nullable(),
  rolledBackAt: isoDate.nullable(),
  createdAt: isoDate,
  progress: importProgressSchema.nullable(),
  /** `false` once the 24 h copy of the uploaded file is gone: upload again. */
  fileAvailable: z.boolean(),
  report: importReportSchema.nullable(),
});
export type ImportView = z.infer<typeof importViewSchema>;

export const importListResponseSchema = z.object({
  items: z.array(importViewSchema.omit({ report: true, progress: true, fileAvailable: true })),
});

export const rollbackResponseSchema = z.object({
  deletedDrugs: z.number().int(),
  untaggedDrugs: z.number().int(),
  deletedIngredients: z.number().int(),
  deletedAliases: z.number().int(),
});
export type RollbackResult = z.infer<typeof rollbackResponseSchema>;
