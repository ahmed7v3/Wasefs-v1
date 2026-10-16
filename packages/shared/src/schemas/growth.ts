import { z } from "zod";

import { BILLING_KEY_PATTERN } from "../billing.js";
import {
  EXPERIMENT_STATUSES,
  GROWTH_EVENT_NAMES,
  GROWTH_EVENT_PROPS_MAX_BYTES,
  PHI_ACCESS_REASONS,
} from "../growth.js";
import { FLAG_KEY_PATTERN } from "../settings.js";

/*
 * Growth contract (Phase 3, Task 3.1; GROWTH-STRATEGY §9). Events are first-party, small and carry
 * no PHI and no free text: props are flat scalars with short values.
 */

export const growthEventNameSchema = z.enum(GROWTH_EVENT_NAMES);

const propValue = z.union([z.string().max(64), z.number().finite(), z.boolean()]);

export const growthEventInputSchema = z.object({
  name: growthEventNameSchema,
  sessionId: z.string().min(8).max(64),
  props: z
    .record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,31}$/), propValue)
    .default({})
    .refine((props) => JSON.stringify(props).length <= GROWTH_EVENT_PROPS_MAX_BYTES, "too large"),
  variant: z.string().regex(BILLING_KEY_PATTERN).nullable().default(null),
});
export type GrowthEventInput = z.output<typeof growthEventInputSchema>;

export const experimentVariantSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  /** Share of users in percent; the variants of one experiment add up to 100. */
  weight: z.number().int().min(0).max(100),
});

/** `experiments.variants`: 2 to 10 variants, unique keys, weights adding up to 100. */
export const experimentVariantsSchema = z
  .array(experimentVariantSchema)
  .min(2)
  .max(10)
  .refine((variants) => new Set(variants.map((variant) => variant.key)).size === variants.length, {
    message: "variant keys must be unique",
  })
  .refine((variants) => variants.reduce((sum, variant) => sum + variant.weight, 0) === 100, {
    message: "weights must add up to 100",
  });
export type ExperimentVariants = z.output<typeof experimentVariantsSchema>;

export const createExperimentSchema = z.object({
  key: z.string().regex(BILLING_KEY_PATTERN),
  name: z.string().trim().min(1).max(120),
  flagKey: z.string().regex(FLAG_KEY_PATTERN),
  variants: experimentVariantsSchema,
  status: z.enum(EXPERIMENT_STATUSES).default("draft"),
  minSampleSize: z.number().int().min(1).max(10_000_000).nullable().default(null),
});
export type CreateExperimentInput = z.output<typeof createExperimentSchema>;

/** Opening a user's health data: one reason per 30-minute access session. */
export const phiAccessInputSchema = z.object({
  userId: z.uuid(),
  reason: z.enum(PHI_ACCESS_REASONS),
  note: z.string().trim().max(500).nullable().default(null),
});
