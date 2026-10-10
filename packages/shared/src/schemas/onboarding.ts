import { z } from "zod";

import {
  ACCOUNT_TYPES,
  ONBOARDING_STEPS,
  PROFESSIONS,
  USAGE_INTENTS,
  type OnboardingStep,
} from "../identity.js";

import { citySchema, countryCodeSchema, orgDetailsSchema } from "./org.js";
import { personNameSchema } from "./user.js";

/*
 * Onboarding wizard (Task 1.7, ARCHITECTURE §3). One body schema per step; `PUT /onboarding/:step`
 * picks the schema by the path parameter. The server decides which steps apply and in what order;
 * the client only answers the current step (or re-answers an earlier one).
 */

/** Steps a client can submit (`done` is a state, not a step). */
export const ONBOARDING_INPUT_STEPS = ONBOARDING_STEPS.filter(
  (step): step is Exclude<OnboardingStep, "done"> => step !== "done",
);
export type OnboardingInputStep = (typeof ONBOARDING_INPUT_STEPS)[number];

export const onboardingStepParamSchema = z.object({ step: z.enum(ONBOARDING_INPUT_STEPS) });

/** The only plan before Phase 2. */
export const ONBOARDING_PLANS = ["free"] as const;

export const ONBOARDING_STEP_SCHEMAS = {
  account_type: z.object({ accountType: z.enum(ACCOUNT_TYPES) }),
  /** Nothing to send: the step passes once the phone is verified (Task 1.5 flow). */
  phone: z.object({}),
  name: z.object({ name: personNameSchema }),
  organization: orgDetailsSchema,
  profession_intent: z.object({
    profession: z.enum(PROFESSIONS),
    usageIntent: z
      .array(z.enum(USAGE_INTENTS))
      .min(1)
      .max(USAGE_INTENTS.length)
      .refine((items) => new Set(items).size === items.length, "duplicate"),
    country: countryCodeSchema,
    city: citySchema.optional(),
  }),
  plan_picker: z.object({ plan: z.enum(ONBOARDING_PLANS) }),
  /** Optional step: `followed: false` means skipped. */
  social_follow: z.object({ followed: z.boolean() }),
} as const satisfies Record<OnboardingInputStep, z.ZodType>;

export type OnboardingStepInput<S extends OnboardingInputStep> = z.input<
  (typeof ONBOARDING_STEP_SCHEMAS)[S]
>;

export const ONBOARDING_STEP_STATUSES = ["completed", "current", "pending", "skipped"] as const;

const isoDate = z.iso.datetime({ offset: true });

export const onboardingStateSchema = z.object({
  currentStep: z.enum(ONBOARDING_STEPS),
  done: z.boolean(),
  completedAt: isoDate.nullable(),
  /** Only the steps that apply to this user, in order. `skipped` = passed without an answer. */
  steps: z.array(
    z.object({
      step: z.enum(ONBOARDING_INPUT_STEPS),
      status: z.enum(ONBOARDING_STEP_STATUSES),
      optional: z.boolean(),
    }),
  ),
  /** Current answers, for pre-filling the forms when the user comes back. */
  answers: z.object({
    accountType: z.enum(ACCOUNT_TYPES),
    name: z.string(),
    phone: z.string().nullable(),
    phoneVerified: z.boolean(),
    /** True when the phone step can be passed without a verified phone (verification unavailable and email verified). */
    phoneSkippable: z.boolean(),
    organization: z
      .object({
        id: z.uuid(),
        name: z.string(),
        type: orgDetailsSchema.shape.type,
        country: z.string(),
        city: z.string().nullable(),
      })
      .nullable(),
    profession: z.enum(PROFESSIONS).nullable(),
    usageIntent: z.array(z.enum(USAGE_INTENTS)),
    country: z.string().nullable(),
    city: z.string().nullable(),
    plan: z.enum(ONBOARDING_PLANS).nullable(),
  }),
});
export type OnboardingState = z.output<typeof onboardingStateSchema>;
