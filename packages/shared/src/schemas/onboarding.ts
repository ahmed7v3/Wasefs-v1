import { z } from "zod";

import {
  ACCOUNT_TYPES,
  ONBOARDING_STEPS,
  PROFESSIONS,
  USAGE_INTENTS,
  type OnboardingStep,
} from "../identity.js";
import { PLAN_KEY_PATTERN } from "../plans.js";

import { monthsSchema } from "./billing.js";
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

/**
 * The plan the user chose on the last step: `free` finishes onboarding, `paid` is a recorded intent
 * and sends them to checkout (which validates the plan against the catalog).
 */
export const ONBOARDING_PLANS = ["free", "paid"] as const;

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
  plan_picker: z.discriminatedUnion("plan", [
    z.object({ plan: z.literal("free") }),
    z.object({
      plan: z.literal("paid"),
      planKey: z.string().max(40).regex(PLAN_KEY_PATTERN),
      months: monthsSchema,
    }),
  ]),
  /** Optional step: `followed: false` means skipped. */
  social_follow: z.object({ followed: z.boolean() }),
} as const satisfies Record<OnboardingInputStep, z.ZodType>;

/**
 * `PUT /onboarding/welcome` (docs/WA-SIGNUP.md section 4): the whole wizard on one screen. It answers
 * account_type, name, organization (only for an organization) and, if chosen, the profession; the
 * server fills in the rest (social follow skipped, free plan intent) through the normal step rules.
 */
export const onboardingWelcomeSchema = z
  .object({
    accountType: z.enum(ACCOUNT_TYPES),
    name: personNameSchema,
    organization: orgDetailsSchema.optional(),
    profession: z.enum(PROFESSIONS).optional(),
  })
  .superRefine((value, context) => {
    const wantsOrganization = value.accountType === "organization";
    if (wantsOrganization !== (value.organization !== undefined)) {
      context.addIssue({ code: "custom", path: ["organization"], message: "organization" });
    }
  });
export type OnboardingWelcomeInput = z.output<typeof onboardingWelcomeSchema>;

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
