import { z } from "zod";

import { DRUG_ALIAS_LANGS, DRUG_IMPORT_STATUSES, DRUG_SOURCES, DRUG_STATUSES } from "../ai.js";
import { DRUG_IMPORT_FIELDS, DRUG_IMPORT_ROW_STATUSES, DRUG_MATCH_LIMIT } from "../drugs.js";
import { COUNTRY_CODE_PATTERN } from "../identity.js";

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

export const drugSearchQuerySchema = z.object({
  /** Free text; without it the most recently changed drugs are listed. */
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
  ingredients: z.array(drugIngredientViewSchema),
  aliases: z.array(drugAliasViewSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type DrugView = z.infer<typeof drugViewSchema>;

const matchExplanationSchema = z.object({
  nameScore: z.number(),
  matchedOn: z.enum(["brand", "alias", "ingredient"]),
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

export const drugSearchResponseSchema = z.object({ items: z.array(drugSearchItemSchema) });

export const updateDrugSchema = z
  .object({
    brandEn: z.string().trim().min(1).max(300),
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
    status: z.enum(DRUG_STATUSES),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "at least one field");
export type UpdateDrugInput = z.infer<typeof updateDrugSchema>;

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
