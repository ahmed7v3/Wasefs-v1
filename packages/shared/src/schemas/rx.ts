/*
 * Prescription analysis contracts (Phase 2, Task 2.8). Versioned: bump RX_SCHEMA_VERSION on any
 * change to a stored shape (`rx_analyses.result`), never edit a field's meaning in place.
 */
import { z } from "zod";

import { AI_MODES } from "../ai.js";
import { RX_MAX_PAGES } from "../rx.js";

export const RX_SCHEMA_VERSION = 1;

/** Normalized 0-1000 box `[ymin, xmin, ymax, xmax]` (Gemini convention). */
export const box2dSchema = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine((b) => b.every((v) => v >= 0 && v <= 1000) && b[0] < b[2] && b[1] < b[3], "bad_box");

const text = z.string().trim().max(200).nullable();

/** What the model returns for `rx_extract` (the JSON schema sent to the provider mirrors it). */
export const rxExtractItemSchema = z.object({
  rawText: z.string().trim().max(300),
  name: text,
  strength: text,
  form: text,
  dose: text,
  frequency: text,
  duration: text,
  route: text,
  notes: text,
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
  date: z.string().trim().max(40).nullable(),
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

/** `rx_verify` answer per flagged item: a candidate id, free text, or unreadable. */
export const rxVerifyAnswerSchema = z.object({
  answers: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          index: z.number().int().min(0),
          kind: z.literal("candidate"),
          id: z.string().uuid(),
        }),
        z.object({
          index: z.number().int().min(0),
          kind: z.literal("other"),
          text: z.string().trim().min(1).max(200),
        }),
        z.object({ index: z.number().int().min(0), kind: z.literal("unreadable") }),
      ]),
    )
    .max(40),
});
export type RxVerifyAnswer = z.infer<typeof rxVerifyAnswerSchema>;

export const RX_CONFIDENCE_BADGES = ["high", "medium", "low"] as const;
export type RxConfidenceBadge = (typeof RX_CONFIDENCE_BADGES)[number];
/** Badge thresholds on the final confidence = min(model, match, verify). */
export const RX_BADGE_HIGH = 0.85;
export const RX_BADGE_MEDIUM = 0.5;

/** One item as stored and shown. An unmatched drug can never carry the `high` badge. */
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
  })
  .superRefine((r, ctx) => {
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
