import type { MessageKey } from "@wasfa/shared/i18n";
import type { OnboardingInputStep } from "@wasfa/shared/schemas/onboarding";

/** Title (the step's `h1`) and lead sentence of every wizard step. */
export const STEP_COPY = {
  account_type: {
    title: "onboarding.step.account_type.title",
    lead: "onboarding.step.account_type.lead",
  },
  phone: { title: "onboarding.step.phone.title", lead: "onboarding.step.phone.lead" },
  name: { title: "onboarding.step.name.title", lead: "onboarding.step.name.lead" },
  organization: {
    title: "onboarding.step.organization.title",
    lead: "onboarding.step.organization.lead",
  },
  profession_intent: {
    title: "onboarding.step.profession_intent.title",
    lead: "onboarding.step.profession_intent.lead",
  },
  plan_picker: {
    title: "onboarding.step.plan_picker.title",
    lead: "onboarding.step.plan_picker.lead",
  },
  social_follow: {
    title: "onboarding.step.social_follow.title",
    lead: "onboarding.step.social_follow.lead",
  },
} as const satisfies Record<OnboardingInputStep, { title: MessageKey; lead: MessageKey }>;

const CONFLICT_MESSAGES = {
  onboarding_complete: "onboarding.conflict.onboarding_complete",
  step_not_applicable: "onboarding.conflict.step_not_applicable",
  step_out_of_order: "onboarding.conflict.step_out_of_order",
  phone_not_verified: "onboarding.conflict.phone_not_verified",
  account_type_locked: "onboarding.conflict.account_type_locked",
} as const satisfies Record<string, MessageKey>;

/** The message key of a `CONFLICT` reason from `PUT /onboarding/:step`; unknown reasons get the generic one. */
export function conflictMessageKey(reason: string | undefined): MessageKey {
  return reason !== undefined && Object.hasOwn(CONFLICT_MESSAGES, reason)
    ? CONFLICT_MESSAGES[reason as keyof typeof CONFLICT_MESSAGES]
    : "onboarding.conflict.generic";
}
