/*
 * Prescription analysis contracts (Phase 2, Task 2.8). Versioned: bump RX_SCHEMA_VERSION on any
 * change to a stored shape (`rx_analyses.result`), never edit a field's meaning in place.
 */
import { z } from "zod";

import { AI_MODES } from "../ai.js";
import {
  RX_FIELDS,
  RX_LEGIBILITIES,
  RX_MAX_PAGES,
  RX_RATING_NOTE_MAX,
  RX_RATINGS,
  RX_STATUSES,
} from "../rx.js";

export const RX_SCHEMA_VERSION = 1;

/** Normalized 0-1000 box `[ymin, xmin, ymax, xmax]` (Gemini convention). */
export const box2dSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine((b) => b.every((v) => v >= 0 && v <= 1000) && b[0] < b[2] && b[1] < b[3], "bad_box");

/**
 * Free text read from a prescription. A model that writes a little too much must not lose the whole
 * reading (a long `date` or `notes` once failed an otherwise valid answer): it is trimmed to length.
 */
const clip = (max: number) => z.string().transform((value) => value.trim().slice(0, max));
const text = clip(200).nullable();

/** What the model returns for `rx_extract` (the JSON schema sent to the provider mirrors it). */
export const rxExtractItemSchema = z.object({
  rawText: clip(300),
  name: text,
  /** The generic (active ingredient) name, when the model is sure of it; `null` otherwise. */
  activeIngredient: text.optional().default(null),
  strength: text,
  form: text,
  dose: text,
  frequency: text,
  duration: text,
  route: text,
  notes: text,
  /**
   * Other plausible readings of the NAME exactly as written (0-3). Extra ones are dropped, not an
   * error; absent in older stored results.
   */
  alternatives: z
    .array(clip(80))
    .transform((names) => names.filter((name) => name !== "").slice(0, 3))
    .optional()
    .default([]),
  /** How well the name could be read; absent (older results) counts as `partial`. */
  legibility: z.enum(RX_LEGIBILITIES).optional().default("partial"),
  confidence: z.number().min(0).max(1),
  box_2d: box2dSchema.nullable(),
  page: z
    .number()
    .int()
    .min(0)
    .max(RX_MAX_PAGES - 1),
});

export const rxExtractionSchema = z.object({
  items: z.array(rxExtractItemSchema).max(40),
  prescriberLegible: z.boolean(),
  date: clip(40).nullable(),
  unreadableRegions: z
    .array(
      z.object({
        page: z
          .number()
          .int()
          .min(0)
          .max(RX_MAX_PAGES - 1),
        box_2d: box2dSchema,
      }),
    )
    .max(40),
});
export type RxExtraction = z.infer<typeof rxExtractionSchema>;

/** `rx_verify` answer per flagged item: a candidate id, none of them, free text, or unreadable. */
export const rxVerifyAnswerSchema = z.object({
  answers: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          index: z.number().int().min(0),
          kind: z.literal("candidate"),
          id: z.string().uuid(),
          /** How sure the model is that the candidate is what is written (0-1). Decides `likely` vs `ai`. */
          confidence: z.number().min(0).max(1),
        }),
        z.object({
          index: z.number().int().min(0),
          kind: z.literal("other"),
          text: z.string().trim().min(1).max(200),
        }),
        // The line is readable but is none of the offered candidates: the AI reading stands.
        z.object({ index: z.number().int().min(0), kind: z.literal("none") }),
        z.object({ index: z.number().int().min(0), kind: z.literal("unreadable") }),
      ]),
    )
    .max(40),
});
export type RxVerifyAnswer = z.infer<typeof rxVerifyAnswerSchema>;

/** Outcome of one line against the drug database (see `rxResultItemSchema.match`). */
export const RX_MATCH_OUTCOMES = ["confirmed", "likely", "ai"] as const;
export type RxMatchOutcome = (typeof RX_MATCH_OUTCOMES)[number];

export const RX_CONFIDENCE_BADGES = ["high", "medium", "low"] as const;
export type RxConfidenceBadge = (typeof RX_CONFIDENCE_BADGES)[number];
/** Badge thresholds on the final confidence = min(model, match, verify). */
export const RX_BADGE_HIGH = 0.85;
export const RX_BADGE_MEDIUM = 0.5;

/** General information about one medicine, written by the model from its name only (no image, no patient data). */
export const rxItemDetailsSchema = z.object({
  /** What the medicine is generally used for, in one or two sentences. */
  purpose: clip(300).nullable(),
  /** Common side effects, short phrases. */
  sideEffects: z.array(clip(120)).max(6),
  /** General precautions, short phrases ("avoid with ..."). */
  precautions: z.array(clip(160)).max(5),
});
export type RxItemDetails = z.infer<typeof rxItemDetailsSchema>;

/** A hedged overview of what the medicines are commonly used for together. Never a diagnosis. */
export const rxOverviewSchema = z.object({
  summary: clip(600),
  /** Conditions these medicines are commonly prescribed for, phrased as possibilities. */
  likelyConditions: z.array(clip(100)).max(5),
});
export type RxOverview = z.infer<typeof rxOverviewSchema>;

/** One item as stored and shown. With database matching on, an unmatched drug can never carry the `high` badge. */
export const rxResultItemSchema = z.object({
  rawText: z.string().max(300),
  name: text,
  matchedDrugId: z.string().uuid().nullable(),
  matchScore: z.number().min(0).max(1).nullable(),
  activeIngredients: z.array(z.string().max(120)).max(10),
  strength: text,
  form: text,
  dose: text,
  frequency: text,
  duration: text,
  route: text,
  notes: text,
  confidence: z.number().min(0).max(1),
  badge: z.enum(RX_CONFIDENCE_BADGES),
  verified: z.enum(["not_needed", "confirmed", "corrected", "unreadable", "skipped"]),
  /** `ai`: the name is the model's reading, not confirmed in the database. Absent on older results. */
  source: z.enum(["database", "ai"]).optional(),
  /**
   * The line's outcome: `confirmed` (a clear name that matches the database), `likely` (the model chose
   * a database candidate for an unclear name; shown as "مرجّح"), `ai` (the model's own reading stands).
   * Absent on older results, where `source` alone tells the story.
   */
  match: z.enum(RX_MATCH_OUTCOMES).optional(),
  /** `ai` lines only: the best candidate the model leaned to but was not sure of; offered first on "عدّل". */
  suggestion: z
    .object({ drugId: z.string().uuid(), name: clip(200) })
    .nullable()
    .optional(),
  /** The model's own reading of the name, kept when the name shown is a database brand (feeds learning from corrections). */
  reading: text.optional(),
  /** Added after the reading by the details step; absent on older results and when it failed. */
  details: rxItemDetailsSchema.nullable().optional(),
  box_2d: box2dSchema.nullable(),
  page: z
    .number()
    .int()
    .min(0)
    .max(RX_MAX_PAGES - 1),
});
export type RxResultItem = z.infer<typeof rxResultItemSchema>;

export const rxResultSchema = z
  .object({
    schemaVersion: z.literal(RX_SCHEMA_VERSION),
    items: z.array(rxResultItemSchema).max(40),
    date: z.string().max(40).nullable(),
    prescriberLegible: z.boolean(),
    /** Deterministic findings only (duplicate ingredient, strength not in the database). */
    findings: z
      .array(
        z.object({
          kind: z.enum(["duplicate_ingredient", "strength_unknown"]),
          itemIndexes: z.array(z.number().int().min(0)).max(40),
          ingredient: z.string().max(120).nullable(),
        }),
      )
      .max(40),
    unreadableRegions: rxExtractionSchema.shape.unreadableRegions,
    /** `model`: lines were not matched to the drug database (rx.drugMatching off). Absent = `database`. */
    matching: z.enum(["database", "model"]).optional(),
    overview: rxOverviewSchema.nullable().optional(),
    /** `unavailable` when the details step failed or is switched off; the reading itself is unaffected. */
    detailsStatus: z.enum(["ready", "unavailable"]).optional(),
  })
  .superRefine((r, ctx) => {
    // Without the drug database there is nothing to match against, so confidence comes from the
    // model alone and an unmatched line may be `high`.
    if (r.matching === "model") return;
    r.items.forEach((item, i) => {
      if (item.matchedDrugId === null && item.badge === "high") {
        ctx.addIssue({ code: "custom", path: ["items", i, "badge"], message: "unmatched_high" });
      }
    });
  });
export type RxResult = z.infer<typeof rxResultSchema>;

/** `POST /rx` */
export const rxCreateRequestSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(RX_MAX_PAGES),
  mode: z.enum(AI_MODES).default("balanced"),
  /** Act for this organization (its plan, quota and wallet); the caller must be an active member. */
  orgId: z.uuid().optional(),
});
export type RxCreateRequest = z.infer<typeof rxCreateRequestSchema>;

/** Progress events on `rx:<id>` (relayed as SSE). Step text comes from i18n, never from here. */
export const RX_STEPS = ["read", "match", "verify", "finalize"] as const;
export const rxEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step"), step: z.enum(RX_STEPS), seq: z.number().int() }),
  z.object({
    type: z.literal("done"),
    status: z.enum(["done", "refunded"]),
    seq: z.number().int(),
  }),
  z.object({ type: z.literal("failed"), errorRef: z.string().max(40), seq: z.number().int() }),
]);
export type RxEvent = z.infer<typeof rxEventSchema>;

/*
 * ---------------------------------------------------------------------------------------------
 * Task 2.8 additions: the JSON schemas sent to the provider (written by hand, kept in step with
 * the zod schemas above by a test that feeds both the same fixtures), the job payload and the
 * contract of the `/rx` routes. Nothing above this line changes meaning.
 * ---------------------------------------------------------------------------------------------
 */

const nullableText = { type: ["string", "null"] } as const;
const box2dJson = {
  type: "array",
  items: { type: "number", minimum: 0, maximum: 1000 },
  minItems: 4,
  maxItems: 4,
  description: "[ymin, xmin, ymax, xmax] normalized 0-1000",
} as const;
const pageJson = { type: "integer", minimum: 0, maximum: RX_MAX_PAGES - 1 } as const;

/** JSON schema for `rx_extract` (mirrors `rxExtractionSchema`; strict-mode friendly: closed objects, every key required). */
export const rxExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "prescriberLegible", "date", "unreadableRegions"],
  properties: {
    items: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rawText",
          "name",
          "activeIngredient",
          "strength",
          "form",
          "dose",
          "frequency",
          "duration",
          "route",
          "notes",
          "alternatives",
          "legibility",
          "confidence",
          "box_2d",
          "page",
        ],
        properties: {
          rawText: { type: "string", maxLength: 300 },
          name: nullableText,
          activeIngredient: nullableText,
          strength: nullableText,
          form: nullableText,
          dose: nullableText,
          frequency: nullableText,
          duration: nullableText,
          route: nullableText,
          notes: nullableText,
          alternatives: {
            type: "array",
            maxItems: 3,
            items: { type: "string", maxLength: 80 },
            description:
              "Other plausible readings of the drug NAME exactly as written; empty when the letters are not ambiguous",
          },
          legibility: {
            type: "string",
            enum: RX_LEGIBILITIES,
            description: "How well the drug name could be read",
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          box_2d: { ...box2dJson, type: ["array", "null"] },
          page: pageJson,
        },
      },
    },
    prescriberLegible: { type: "boolean" },
    date: nullableText,
    unreadableRegions: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "box_2d"],
        properties: { page: pageJson, box_2d: box2dJson },
      },
    },
  },
} as const;

/** JSON schema for `rx_verify` (mirrors `rxVerifyAnswerSchema`): one of four closed shapes per item. */
export const rxVerifyJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      maxItems: 40,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["index", "kind", "id", "confidence"],
            properties: {
              index: { type: "integer", minimum: 0 },
              kind: { type: "string", enum: ["candidate"] },
              id: { type: "string", description: "id of one of the offered candidates" },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "how sure you are that this candidate is what is written, 0-1",
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["index", "kind", "text"],
            properties: {
              index: { type: "integer", minimum: 0 },
              kind: { type: "string", enum: ["other"] },
              text: { type: "string", maxLength: 200, description: "the text you read" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["index", "kind"],
            properties: {
              index: { type: "integer", minimum: 0 },
              kind: { type: "string", enum: ["none"] },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["index", "kind"],
            properties: {
              index: { type: "integer", minimum: 0 },
              kind: { type: "string", enum: ["unreadable"] },
            },
          },
        ],
      },
    },
  },
} as const;

/** `rx.analyze`: the only job of the `rx` queue; everything else is read from the row. */
/** `planOrgId`: the analysis was made in an organization context, so that organization's plan routes it. */
export const rxAnalyzePayloadSchema = z.object({
  analysisId: z.uuid(),
  planOrgId: z.uuid().optional(),
  /** A taste of Deep mode (Task 3.14): route by this (paid) plan, whose model the taste lets the user try. */
  routePlanId: z.uuid().optional(),
});

/** Redis names shared by the worker (publisher) and the API (SSE relay). */
export const rxChannel = (analysisId: string): string => `rx:${analysisId}`;
/** Monotonic event counter of one analysis, so `seq` keeps growing across job retries. */
export const rxSeqKey = (analysisId: string): string => `rx:${analysisId}:seq`;
/** The last event published, kept so a client that connects late starts from the current step. */
export const rxLastEventKey = (analysisId: string): string => `rx:${analysisId}:last`;
export const RX_EVENT_TTL_SECONDS = 24 * 60 * 60;

/** An owner re-uploading the same pages within this long gets the cached answer for free. */
export const RX_FREE_CACHE_HOURS = 24;
/** Near-duplicate hint window and Hamming distance (of the 64-bit dHash), same owner only. */
export const RX_NEAR_DUPLICATE_DAYS = 7;
export const RX_NEAR_DUPLICATE_MAX_DISTANCE = 6;

const isoDate = z.iso.datetime({ offset: true });

export const rxCreateResponseSchema = z.object({
  id: z.uuid(),
  /** An earlier analysis of the same owner with a look-alike page: offered, never reused silently. */
  nearDuplicate: z.object({ analysisId: z.uuid(), createdAt: isoDate }).nullable(),
});
export type RxCreateResponse = z.infer<typeof rxCreateResponseSchema>;

export const rxViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(RX_STATUSES),
  mode: z.enum(AI_MODES),
  result: rxResultSchema.nullable(),
  creditsCharged: z.number().int().min(0),
  /** True when the answer was copied from an earlier identical analysis (no provider call). */
  cached: z.boolean(),
  createdAt: isoDate,
  queuedAt: isoDate,
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
  errorRef: z.string().nullable(),
  /** What the person said about this analysis, if anything (Task 2.14). */
  rating: z.enum(RX_RATINGS).nullable().default(null),
  /** They agreed that the picture and the result may be shown to the team to improve accuracy. */
  shareForReview: z.boolean().default(false),
  /** The pages in order; `imageDeleted` once the retention job removed the picture (the result stays). */
  files: z.array(
    z.object({ fileId: z.uuid(), pageNo: z.number().int().min(1), imageDeleted: z.boolean() }),
  ),
});
export type RxView = z.infer<typeof rxViewSchema>;

/** `POST /rx/:id/rating`: excellent or needs improving, an optional note, and the sharing consent (off by default). */
export const rxRatingRequestSchema = z.object({
  rating: z.enum(RX_RATINGS),
  note: z.string().trim().max(RX_RATING_NOTE_MAX).optional(),
  shareForReview: z.boolean().default(false),
});
export type RxRatingRequest = z.output<typeof rxRatingRequestSchema>;
export const rxRatingResponseSchema = z.object({
  rating: z.enum(RX_RATINGS),
  shareForReview: z.boolean(),
});
export type RxRatingResponse = z.output<typeof rxRatingResponseSchema>;

export const rxListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  /** Matches item names inside the results. */
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const rxListItemSchema = z.object({
  id: z.uuid(),
  status: z.enum(RX_STATUSES),
  mode: z.enum(AI_MODES),
  createdAt: isoDate,
  itemCount: z.number().int().min(0),
  /** The first few item names, for the history row. */
  itemNames: z.array(z.string()).max(3),
  pageCount: z.number().int().min(0),
  creditsCharged: z.number().int().min(0),
});
export const rxListResponseSchema = z.object({
  items: z.array(rxListItemSchema),
  nextCursor: z.string().nullable(),
});
export type RxListQuery = z.output<typeof rxListQuerySchema>;
export type RxListResponse = z.output<typeof rxListResponseSchema>;

export const rxItemParamsSchema = z.object({
  id: z.uuid(),
  itemIndex: z.coerce.number().int().min(0).max(39),
});

/** `POST /rx/:id/corrections`. For `field = drug`, `after` is a drug id (a picked candidate) or free text. */
export const rxCorrectionRequestSchema = z.object({
  itemIndex: z.number().int().min(0).max(39),
  field: z.enum(RX_FIELDS),
  after: z.string().trim().min(1).max(200),
  consentForEval: z.boolean().default(false),
});
export type RxCorrectionRequest = z.infer<typeof rxCorrectionRequestSchema>;
export const rxCorrectionResponseSchema = z.object({ result: rxResultSchema });

export const rxCandidateSchema = z.object({
  drugId: z.uuid(),
  brandEn: z.string(),
  brandAr: z.string().nullable(),
  form: z.string().nullable(),
  strengthText: z.string().nullable(),
  manufacturer: z.string().nullable(),
  status: z.enum(["active", "withdrawn"]),
  score: z.number().min(0).max(1),
  matchClass: z.enum(["accept", "verify", "unmatched"]),
});
export const rxCandidatesResponseSchema = z.object({ candidates: z.array(rxCandidateSchema) });
export type RxCandidatesResponse = z.output<typeof rxCandidatesResponseSchema>;

/** What the details call returns: one entry per listed medicine, plus the hedged overview. */
export const rxDetailsAnswerSchema = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().min(0),
        purpose: clip(300).nullable(),
        sideEffects: z.array(clip(120)).max(6),
        precautions: z.array(clip(160)).max(5),
      }),
    )
    .max(40),
  overview: rxOverviewSchema.nullable(),
});
export type RxDetailsAnswer = z.infer<typeof rxDetailsAnswerSchema>;

/** JSON schema for the details call (mirrors `rxDetailsAnswerSchema`). */
export const rxDetailsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "overview"],
  properties: {
    items: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "purpose", "sideEffects", "precautions"],
        properties: {
          index: { type: "integer", minimum: 0 },
          purpose: { type: ["string", "null"], maxLength: 300 },
          sideEffects: { type: "array", maxItems: 6, items: { type: "string", maxLength: 120 } },
          precautions: { type: "array", maxItems: 5, items: { type: "string", maxLength: 160 } },
        },
      },
    },
    overview: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["summary", "likelyConditions"],
      properties: {
        summary: { type: "string", maxLength: 600 },
        likelyConditions: { type: "array", maxItems: 5, items: { type: "string", maxLength: 100 } },
      },
    },
  },
} as const;
