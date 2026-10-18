import { z } from "zod";

import { BILLING_KEY_PATTERN } from "../billing.js";
import {
  EXPERIMENT_STATUSES,
  GROWTH_CTA_KINDS,
  GROWTH_EVENT_NAMES,
  GROWTH_EVENT_PROPS_MAX_BYTES,
  GROWTH_LOCKED_FEATURES,
  GROWTH_PROMPT_CONTEXTS,
  GROWTH_PROMPT_KINDS,
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
    .refine((props) => JSON.stringify(props).length <= GROWTH_EVENT_PROPS_MAX_BYTES, "too large")
    // No personal or health text may enter analytics, whatever the client sends.
    .refine(
      (props) => !Object.entries(props).some(([key, value]) => isForbiddenGrowthProp(key, value)),
      "personal data",
    ),
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

// --- Event ingestion (Task 3.14) ---------------------------------------------------------------------

/** Keys a client must never send: they would carry health data or personal text into analytics. */
export const GROWTH_FORBIDDEN_PROP_KEYS = [
  "name",
  "email",
  "phone",
  "drug",
  "drugname",
  "medicine",
  "patient",
  "diagnosis",
  "text",
  "rawtext",
  "note",
  "notes",
  "message",
  "address",
] as const;

const EMAIL_LIKE = /\S+@\S+\.\S+/;
const PHONE_LIKE = /\+?\d[\d\s-]{7,}/;

/** A prop pair that could carry personal data: a forbidden key, or a value that looks like an email or number. */
export function isForbiddenGrowthProp(key: string, value: string | number | boolean): boolean {
  if ((GROWTH_FORBIDDEN_PROP_KEYS as readonly string[]).includes(key.toLowerCase())) return true;
  return typeof value === "string" && (EMAIL_LIKE.test(value) || PHONE_LIKE.test(value));
}

/** Client events as one array; entries are checked one by one, so an unknown event is dropped, not fatal. */
export const growthEventsRequestSchema = z.object({
  events: z.array(z.unknown()).min(1).max(20),
});
export type GrowthEventsRequest = z.output<typeof growthEventsRequestSchema>;

/** The largest accepted body of `POST /growth/events`, in bytes. */
export const GROWTH_EVENTS_MAX_BODY_BYTES = 16_384;

export const growthEventsResponseSchema = z.object({
  accepted: z.number().int().min(0),
  dropped: z.number().int().min(0),
});

// --- Prompts -----------------------------------------------------------------------------------------

export const growthPromptQuerySchema = z.object({
  context: z.enum(GROWTH_PROMPT_CONTEXTS),
  /** `context=result`: the analysis the user is looking at. */
  rxId: z.uuid().optional(),
  /** `context=locked`: the locked feature the user touched. */
  feature: z.enum(GROWTH_LOCKED_FEATURES).optional(),
  /** The browser session: one upgrade prompt per session. */
  sessionId: z.string().min(8).max(64),
  /** The workspace the user acts in (dashboard only): organization prompts instead of personal ones. */
  orgId: z.uuid().optional(),
});
export type GrowthPromptQuery = z.output<typeof growthPromptQuerySchema>;

export const growthPromptSchema = z.object({
  kind: z.enum(GROWTH_PROMPT_KINDS),
  /** The experiment variant that chose the copy; `control` outside an experiment. */
  variant: z.string(),
  /** i18n key (`growth.prompt.<kind>.<variant>`); the text lives in the web dictionary. */
  messageKey: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  cta: z.object({ kind: z.enum(GROWTH_CTA_KINDS), href: z.string().optional() }),
});
export type GrowthPrompt = z.output<typeof growthPromptSchema>;

export const growthPromptResponseSchema = z.object({ prompt: growthPromptSchema.nullable() });
export type GrowthPromptResponse = z.output<typeof growthPromptResponseSchema>;

// --- Taste of Deep mode --------------------------------------------------------------------------------

export const startTasteSchema = z.object({
  rxId: z.uuid(),
  /** Idempotency: the same request id never starts a second taste. */
  requestId: z.uuid(),
});
export type StartTasteInput = z.output<typeof startTasteSchema>;

export const startTasteResponseSchema = z.object({
  grantId: z.uuid(),
  /** The new (deep) analysis of the same pages. */
  analysisId: z.uuid(),
});

export const tasteGrantParamSchema = z.object({ grantId: z.uuid() });

const compareSideSchema = z.object({
  name: z.string().nullable(),
  badge: z.enum(["high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
});

export const tasteCompareItemSchema = z.object({
  index: z.number().int().min(0),
  before: compareSideSchema.nullable(),
  after: compareSideSchema.nullable(),
  improved: z.boolean(),
});
export type TasteCompareItem = z.output<typeof tasteCompareItemSchema>;

export const tasteCompareResponseSchema = z.object({
  grantId: z.uuid(),
  before: z.unknown(),
  after: z.unknown(),
  items: z.array(tasteCompareItemSchema),
});

// --- Offers, value, proof, experiments (customer) ----------------------------------------------------------

export const personalOfferViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["welcome", "winback", "renewal", "taste"]),
  /** The one and only deadline: a server time, identical in every tab and device. */
  expiresAt: z.iso.datetime({ offset: true }),
  discount: z.object({
    kind: z.enum(["percent", "fixed", "bonus_credits", "extra_months"]),
    value: z.number().int(),
    currency: z.string().nullable(),
  }),
  titleAr: z.string(),
  titleEn: z.string(),
});
export type PersonalOfferView = z.output<typeof personalOfferViewSchema>;
export const personalOffersResponseSchema = z.object({ offers: z.array(personalOfferViewSchema) });

export const valueLedgerResponseSchema = z.object({
  analyses: z.number().int().min(0),
  drugsChecked: z.number().int().min(0),
  minutesSavedEstimate: z.number().int().min(0),
  /** The time saved is a rough figure; the web must label it as an estimate. */
  estimate: z.literal(true),
});
export type ValueLedgerResponse = z.output<typeof valueLedgerResponseSchema>;

export const publicProofResponseSchema = z.object({
  /** Present only when the real count is above `growth.proof.minCount`. */
  analysesThisWeek: z.number().int().min(0).optional(),
  /** Present only when that plan holds the largest share of paid subscriptions in 30 days and the sample is big enough. */
  mostChosenPlanKey: z.string().optional(),
});
export type PublicProofResponse = z.output<typeof publicProofResponseSchema>;

export const experimentAssignmentsResponseSchema = z.object({
  assignments: z.array(z.object({ experimentKey: z.string(), variant: z.string() })),
});

// --- Marketing consent and unsubscribe -------------------------------------------------------------------------

export const unsubscribeQuerySchema = z.object({ token: z.string().min(20).max(200) });

// --- Admin: experiments and funnel ---------------------------------------------------------------------------------

export const experimentIdParamSchema = z.object({ id: z.uuid() });

/** Only a draft may change its variants; any status may be renamed or get a new sample target. */
export const updateExperimentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    variants: experimentVariantsSchema,
    minSampleSize: z.number().int().min(1).max(10_000_000).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "empty" });
export type UpdateExperimentInput = z.output<typeof updateExperimentSchema>;

export const experimentViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  flagKey: z.string(),
  variants: z.array(experimentVariantSchema),
  status: z.enum(EXPERIMENT_STATUSES),
  minSampleSize: z.number().int().nullable(),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ExperimentView = z.output<typeof experimentViewSchema>;

export const GUARDRAIL_NAMES = ["refunds", "support", "dismissals", "unsubscribes"] as const;

export const experimentVariantResultSchema = z.object({
  variant: z.string(),
  exposures: z.number().int().min(0),
  conversions: z.number().int().min(0),
  conversionBps: z.number().int().min(0),
  refunds: z.number().int().min(0),
  supportContacts: z.number().int().min(0),
  promptDismissals: z.number().int().min(0),
  unsubscribes: z.number().int().min(0),
  /** Guardrail rates in basis points of exposures. */
  guardrails: z.object({
    refundBps: z.number().int().min(0),
    supportBps: z.number().int().min(0),
    dismissalBps: z.number().int().min(0),
    unsubscribeBps: z.number().int().min(0),
  }),
  /** A guardrail got worse than the control by more than `growth.experiments.guardrailBps`. */
  flaggedRed: z.boolean(),
  flaggedReasons: z.array(z.enum(GUARDRAIL_NAMES)),
  sampleReached: z.boolean(),
});
export type ExperimentVariantResult = z.output<typeof experimentVariantResultSchema>;

export const experimentResultsResponseSchema = z.object({
  experiment: experimentViewSchema,
  minSampleSize: z.number().int(),
  guardrailBps: z.number().int(),
  controlVariant: z.string(),
  variants: z.array(experimentVariantResultSchema),
  /** Every variant has at least `minSampleSize` exposures. */
  minSampleReached: z.boolean(),
});
export type ExperimentResultsResponse = z.output<typeof experimentResultsResponseSchema>;

export const GROWTH_FUNNEL_MAX_DAYS = 366;

export const growthFunnelQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    experiment: z.string().regex(BILLING_KEY_PATTERN).optional(),
  })
  .refine((value) => !(value.from && value.to) || value.to > value.from, { message: "range" });
export type GrowthFunnelQuery = z.output<typeof growthFunnelQuerySchema>;

const funnelStep = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  rateBps: z.number().int().min(0),
});

export const growthFunnelResponseSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  range: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }),
  experiment: z.string().nullable(),
  visitToSignup: funnelStep,
  signupToActivation: funnelStep,
  activationToPaid: funnelStep,
  checkoutToPaid: funnelStep,
  methodMix: z.array(z.object({ method: z.string(), count: z.number().int().min(0) })),
  prompts: z.array(
    z.object({
      kind: z.string(),
      shown: z.number().int().min(0),
      clicked: z.number().int().min(0),
      dismissed: z.number().int().min(0),
    }),
  ),
  tastes: z.object({ started: z.number().int().min(0), completed: z.number().int().min(0) }),
  offers: z.object({ shown: z.number().int().min(0), used: z.number().int().min(0) }),
  referral: z.object({
    signups: z.number().int().min(0),
    paid: z.number().int().min(0),
    /** Invitees per inviter times their paid share, in thousandths. */
    kFactorMilli: z.number().int().min(0),
  }),
});
export type GrowthFunnelResponse = z.output<typeof growthFunnelResponseSchema>;
