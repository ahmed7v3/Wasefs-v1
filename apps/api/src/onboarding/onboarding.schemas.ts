import { monthsSchema } from "@wasfa/shared/schemas/billing";
import {
  ONBOARDING_PLANS,
  onboardingWelcomeSchema,
  ONBOARDING_STEP_SCHEMAS,
  onboardingStepParamSchema,
  type OnboardingInputStep,
} from "@wasfa/shared/schemas/onboarding";
import { z } from "zod";

import { createZodDto, parseWithSchema } from "../common/validation.js";

export class OnboardingStepParamDto extends createZodDto(onboardingStepParamSchema) {}
export class OnboardingWelcomeDto extends createZodDto(onboardingWelcomeSchema) {}

/** What `PUT /onboarding/:step` carries: the step and its body, parsed with that step's own schema. */
export type StepSubmission = {
  [S in OnboardingInputStep]: { step: S; input: z.output<(typeof ONBOARDING_STEP_SCHEMAS)[S]> };
}[OnboardingInputStep];

/** The body schema depends on the path parameter, so the global pipe cannot parse it; this does. */
export function parseSubmission(step: OnboardingInputStep, body: unknown): StepSubmission {
  return { step, input: parseWithSchema(ONBOARDING_STEP_SCHEMAS[step], body) } as StepSubmission;
}

/**
 * Shape of `onboarding_progress.data`. Read defensively: the column is free-form jsonb, so a row
 * that does not match is treated as empty instead of failing the request.
 */
const progressDataSchema = z.object({
  orgId: z.uuid().optional(),
  plan: z.enum(ONBOARDING_PLANS).optional(),
  planKey: z.string().optional(),
  months: monthsSchema.optional(),
  followed: z.boolean().optional(),
});
export type ProgressData = z.output<typeof progressDataSchema>;

export function readProgressData(raw: unknown): ProgressData {
  const parsed = progressDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
