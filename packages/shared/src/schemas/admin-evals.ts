import { z } from "zod";

import { AI_MODES, EVAL_RUN_STATUSES } from "../ai.js";
import { evalExpectedSchema, evalItemScoreSchema, evalRunMetricsSchema } from "../evals.js";
import { EVAL_ITEM_KINDS, RX_FIELDS } from "../rx.js";

import { routeModelParamsSchema } from "./admin-ai.js";
import { rxResultSchema } from "./rx.js";

/*
 * Accuracy evaluation contract (Phase 2, Task 2.10): the label-set import, runs and their
 * comparison, and the review queue of user corrections. Everything needs `evals.run`.
 */

const isoDate = z.iso.datetime({ offset: true });

export const EVAL_RUN_MAX_MODELS = 6;
/** Largest import: one sheet and this many images (one request, admin only). */
export const EVAL_IMPORT_MAX_IMAGES = 300;
export const EVAL_IMPORT_SHEET_MAX_BYTES = 5 * 1024 * 1024;
/** Redis lifetime of an import's report. */
export const EVAL_IMPORT_REPORT_TTL_SECONDS = 24 * 60 * 60;
export const evalImportReportKey = (batchId: string): string => `evalimport:${batchId}`;

export const evalIdParamSchema = z.object({ id: z.uuid() });
export const evalItemParamSchema = z.object({ id: z.uuid(), itemId: z.uuid() });

// --- Queue payloads ---

/** `evals.run`: everything else (set, route snapshot) is read from the run row. */
export const evalRunPayloadSchema = z.object({ runId: z.uuid() });

/**
 * `evals.import`: the sheet and the images wait in object storage under
 * `evals/rx/staging/<batchId>/` (`sheet.xlsx`, `img-<index>`); `images` are the file names the
 * admin uploaded, index = position.
 */
export const evalImportPayloadSchema = z.object({
  batchId: z.uuid(),
  setKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,59}$/),
  setName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable(),
  actorId: z.uuid(),
  images: z.array(z.string().min(1).max(200)).max(EVAL_IMPORT_MAX_IMAGES),
});

// --- Sets and import ---

export const evalSetViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  items: z.number().int().min(0),
  printed: z.number().int().min(0),
  handwritten: z.number().int().min(0),
  /** Items without an image (approved corrections whose picture was already deleted): never run. */
  withoutImage: z.number().int().min(0),
  createdAt: isoDate,
});
export type EvalSetView = z.output<typeof evalSetViewSchema>;
export const evalSetListResponseSchema = z.object({ items: z.array(evalSetViewSchema) });

export const EVAL_IMPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export const evalImportIssueSchema = z.object({
  row: z.number().int().nullable(),
  name: z.string().nullable(),
  code: z.string().max(60),
});
export const evalImportReportSchema = z.object({
  id: z.uuid(),
  status: z.enum(EVAL_IMPORT_STATUSES),
  setId: z.uuid().nullable(),
  /** Prescriptions added to the set. */
  created: z.number().int().min(0),
  issues: z.array(evalImportIssueSchema).max(200),
  /** Set when the whole import failed (unreadable sheet, no storage). */
  errorCode: z.string().nullable(),
});
export type EvalImportReport = z.output<typeof evalImportReportSchema>;
export const evalImportStartedSchema = z.object({ id: z.uuid() });

export const evalImportFieldsSchema = z.object({
  /** An existing set's key adds to it; a new key creates the set. */
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{1,59}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

// --- Runs ---

/** What a run used, frozen when it was queued (the route may change afterwards). */
export const evalRouteSnapshotSchema = z.object({
  task: z.literal("rx_extract"),
  mode: z.enum(AI_MODES),
  routeId: z.uuid().nullable(),
  routeVersion: z.number().int().min(0),
  /** The model that replaced the route's primary for this run (and ran alone); null = the route as it was. */
  comparedModelId: z.uuid().nullable(),
  /** The models the run calls, primary first. */
  models: z
    .array(
      z.object({
        modelId: z.uuid(),
        model: z.string(),
        displayName: z.string(),
        providerKey: z.string(),
        params: routeModelParamsSchema,
      }),
    )
    .min(1)
    .max(EVAL_RUN_MAX_MODELS),
  primaryModelId: z.uuid(),
  skillVersion: z.string(),
});
export type EvalRouteSnapshot = z.output<typeof evalRouteSnapshotSchema>;

export const startEvalRunSchema = z.object({
  setId: z.uuid(),
  mode: z.enum(AI_MODES).default("balanced"),
  /**
   * `ai_models.id` to compare: one run each, with that model as the only one on the `rx_extract`
   * route. Empty = one run on the current route as configured.
   */
  modelIds: z
    .array(z.uuid())
    .max(EVAL_RUN_MAX_MODELS)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, "a model can appear once"),
});
export type StartEvalRunInput = z.output<typeof startEvalRunSchema>;

export const evalRunListQuerySchema = z.object({
  setId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const evalRunSummarySchema = z.object({
  id: z.uuid(),
  setId: z.uuid(),
  setKey: z.string(),
  setName: z.string(),
  status: z.enum(EVAL_RUN_STATUSES),
  snapshot: evalRouteSnapshotSchema.nullable(),
  /** Display name of the model the run is about (the compared model, or the route's primary). */
  modelName: z.string().nullable(),
  metrics: evalRunMetricsSchema.nullable(),
  costUsdMicros: z.number().int().min(0),
  itemsTotal: z.number().int().min(0),
  itemsDone: z.number().int().min(0),
  startedBy: z.uuid().nullable(),
  createdAt: isoDate,
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
});
export type EvalRunSummary = z.output<typeof evalRunSummarySchema>;
export const evalRunListResponseSchema = z.object({ items: z.array(evalRunSummarySchema) });
export const startEvalRunResponseSchema = z.object({ items: z.array(evalRunSummarySchema) });

export const evalRunItemRowSchema = z.object({
  itemId: z.uuid(),
  kind: z.enum(EVAL_ITEM_KINDS),
  expected: z.number().int().min(0),
  scores: evalItemScoreSchema.nullable(),
  costUsdMicros: z.number().int().min(0),
  latencyMs: z.number().int().min(0).nullable(),
  /** A code, never content. */
  error: z.string().nullable(),
  done: z.boolean(),
});
export type EvalRunItemRow = z.output<typeof evalRunItemRowSchema>;

export const evalRunDetailSchema = evalRunSummarySchema.extend({
  items: z.array(evalRunItemRowSchema),
});
export type EvalRunDetail = z.output<typeof evalRunDetailSchema>;

export const evalItemDetailSchema = z.object({
  itemId: z.uuid(),
  kind: z.enum(EVAL_ITEM_KINDS),
  expected: evalExpectedSchema,
  output: rxResultSchema.nullable(),
  scores: evalItemScoreSchema.nullable(),
  costUsdMicros: z.number().int().min(0),
  latencyMs: z.number().int().min(0).nullable(),
  error: z.string().nullable(),
});
export type EvalItemDetail = z.output<typeof evalItemDetailSchema>;

export const evalCompareQuerySchema = z.object({ a: z.uuid(), b: z.uuid() });
export const evalCompareResponseSchema = z.object({
  a: evalRunSummarySchema,
  b: evalRunSummarySchema,
  sameSet: z.boolean(),
  /** Items where the two runs read the names differently (or only one ran). */
  differences: z.array(
    z.object({
      itemId: z.uuid(),
      kind: z.enum(EVAL_ITEM_KINDS),
      expected: z.number().int().min(0),
      aNameCorrect: z.number().int().min(0).nullable(),
      bNameCorrect: z.number().int().min(0).nullable(),
    }),
  ),
});
export type EvalCompareResponse = z.output<typeof evalCompareResponseSchema>;

// --- Review queue ---

export const reviewQueueItemSchema = z.object({
  correctionId: z.uuid(),
  field: z.enum(RX_FIELDS),
  /** The line's name on the stored reading: item text only, nothing about the patient. */
  itemName: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** True while the picture still exists, so approving can copy it into the eval set. */
  imageAvailable: z.boolean(),
  createdAt: isoDate,
});
export type ReviewQueueItem = z.output<typeof reviewQueueItemSchema>;
export const reviewQueueResponseSchema = z.object({ items: z.array(reviewQueueItemSchema) });

export const approveCorrectionSchema = z.object({
  correctionId: z.uuid(),
  setId: z.uuid(),
  kind: z.enum(EVAL_ITEM_KINDS),
});
export type ApproveCorrectionInput = z.output<typeof approveCorrectionSchema>;
export const approveCorrectionResponseSchema = z.object({
  itemId: z.uuid(),
  imageCopied: z.boolean(),
});

export const rejectCorrectionSchema = z.object({ correctionId: z.uuid() });
