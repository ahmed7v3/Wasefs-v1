import {
  ONBOARDING_STEPS,
  OPTIONAL_ONBOARDING_STEPS,
  type AccountType,
  type OnboardingStep,
} from "@wasfa/shared/identity";
import {
  ONBOARDING_INPUT_STEPS,
  type ONBOARDING_STEP_STATUSES,
  type OnboardingInputStep,
} from "@wasfa/shared/schemas/onboarding";

/*
 * The onboarding rules, as a pure function of what is known about the account (ARCHITECTURE §3).
 * No Nest, no database: `OnboardingService` gathers the facts, this file decides. Nothing here is
 * stored except `completedSteps`; the current step and the phone step are always derived live, so a
 * phone that gets verified (or a verification feature that gets switched off) moves the wizard
 * without anyone writing to it.
 */

export type StepStatus = (typeof ONBOARDING_STEP_STATUSES)[number];

export interface MachineState {
  accountType: AccountType;
  phoneVerified: boolean;
  emailVerified: boolean;
  /** `PhoneService.availability().available`: phone verification can be offered right now. */
  phoneVerificationAvailable: boolean;
  /** Steps the user has answered. `phone` is never read from here (see `phoneStepPassed`). */
  completedSteps: readonly OnboardingStep[];
  /** The answer to `social_follow`; `false` means the user skipped it. */
  followed?: boolean | undefined;
  /**
   * Onboarding was finished earlier (`completed_at` is set). Done is sticky: a later change in the
   * environment (phone verification switched back on) must not take a finished user back into the
   * wizard, otherwise `/me` and the `@RequireVerified` guard would disagree.
   */
  finished?: boolean | undefined;
}

export interface StepView {
  step: OnboardingInputStep;
  status: StepStatus;
  optional: boolean;
}

export interface MachineView {
  currentStep: OnboardingStep;
  steps: StepView[];
}

export type SubmitRefusal = "onboarding_complete" | "step_not_applicable" | "step_out_of_order";

export type SubmitCheck = { ok: true } | { ok: false; reason: SubmitRefusal };

/** The phone step can be passed without a verified phone: verification is unavailable and the email is verified. */
export function phoneSkippable(
  state: Pick<MachineState, "phoneVerificationAvailable" | "emailVerified">,
): boolean {
  return !state.phoneVerificationAvailable && state.emailVerified;
}

/** Phone is passed by a verified phone or by skipping; never by `completedSteps`. */
export function phoneStepPassed(state: MachineState): boolean {
  return state.phoneVerified || phoneSkippable(state);
}

export function applicableSteps(accountType: AccountType): OnboardingInputStep[] {
  return ONBOARDING_INPUT_STEPS.filter(
    (step) => step !== "organization" || accountType === "organization",
  );
}

/** How a step that is behind the user ended, or `null` when it still has to be answered. */
function passedStatus(state: MachineState, step: OnboardingInputStep): StepStatus | null {
  if (step === "phone") {
    if (state.phoneVerified) return "completed";
    return phoneSkippable(state) ? "skipped" : null;
  }
  if (!state.completedSteps.includes(step)) return null;
  if (step === "social_follow" && state.followed === false) return "skipped";
  return "completed";
}

export function evaluate(state: MachineState): MachineView {
  let currentStep: OnboardingStep | undefined;
  const steps = applicableSteps(state.accountType).map((step): StepView => {
    const optional = (OPTIONAL_ONBOARDING_STEPS as readonly string[]).includes(step);
    const passed = passedStatus(state, step);
    if (passed !== null) return { step, status: passed, optional };
    // Finished accounts keep what they answered; what they never answered counts as skipped.
    if (state.finished === true) return { step, status: "skipped", optional };
    if (currentStep === undefined) {
      currentStep = step;
      return { step, status: "current", optional };
    }
    return { step, status: "pending", optional };
  });
  return { currentStep: currentStep ?? "done", steps };
}

/**
 * May `step` be submitted now? A step that is passed can be answered again (the wizard's back
 * button); the current step can be answered; nothing beyond the current step can.
 */
export function canSubmit(state: MachineState, step: OnboardingInputStep): SubmitCheck {
  const view = evaluate(state);
  if (view.currentStep === "done") return { ok: false, reason: "onboarding_complete" };
  const found = view.steps.find((candidate) => candidate.step === step);
  if (!found) return { ok: false, reason: "step_not_applicable" };
  if (found.status === "pending") return { ok: false, reason: "step_out_of_order" };
  return { ok: true };
}

/** Stored `completed_steps` are checked by the database against the closed list; this narrows the type. */
export function knownSteps(values: readonly string[]): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => values.includes(step));
}
