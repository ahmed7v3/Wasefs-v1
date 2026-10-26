"use client";

import { t } from "@wasfa/shared/i18n";
import {
  onboardingStateSchema,
  type OnboardingInputStep,
  type OnboardingState,
} from "@wasfa/shared/schemas/onboarding";
import { Spinner } from "@wasfa/ui";
import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";

import { PlanPicker } from "./plan-picker";
import { STEP_COPY, conflictMessageKey } from "./step-copy";
import {
  AccountTypeStep,
  NameStep,
  OrganizationStep,
  PhoneStep,
  ProfessionIntentStep,
  SocialStep,
  type StepProps,
  type SubmitOptions,
} from "./steps";
import { StepProgress } from "./wizard-parts";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { ComponentType } from "react";

const STEP_COMPONENTS: Record<OnboardingInputStep, ComponentType<StepProps>> = {
  account_type: AccountTypeStep,
  phone: PhoneStep,
  name: NameStep,
  organization: OrganizationStep,
  profession_intent: ProfessionIntentStep,
  plan_picker: PlanPicker,
  social_follow: SocialStep,
};

export interface OnboardingWizardProps {
  /** The state the server rendered the page with (`GET /onboarding`). */
  initial: OnboardingState;
  nonce?: string | undefined;
  /** From the public settings: the free plan's monthly analyses and the Facebook page, if any. */
  freeMonthlyAnalyses: number;
  facebookUrl: string | null;
  /** The public catalog for the plan step; null when the API could not answer (free plan only). */
  catalog: CatalogResponse | null;
}

/**
 * The onboarding wizard (ARCHITECTURE §3): one step per screen, saved by the server after each
 * answer. It never decides which steps exist: it renders `steps` and `currentStep` as the server
 * returns them, and lets the user go back to re-answer an earlier applicable step.
 */
export function OnboardingWizard({
  initial,
  nonce,
  freeMonthlyAnalyses,
  facebookUrl,
  catalog,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [viewStep, setViewStep] = useState<string>(initial.currentStep);
  const [conflict, setConflict] = useState<string | null>(null);
  const [leavingMessage, setLeavingMessage] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(viewStep);

  const adopt = useCallback(
    (next: OnboardingState, options?: SubmitOptions) => {
      setState(next);
      setViewStep(next.currentStep);
      if (next.done) {
        setLeavingMessage(options?.doneMessage ?? null);
        router.replace(options?.next ?? "/dashboard");
      }
    },
    [router],
  );

  const submit = useCallback(
    async (step: OnboardingInputStep, body: unknown, options?: SubmitOptions): Promise<void> => {
      setConflict(null);
      try {
        adopt(
          await api(`/onboarding/${step}`, {
            method: "PUT",
            body,
            schema: onboardingStateSchema,
          }),
          options,
        );
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.code !== "CONFLICT") throw error;
        // The server's idea of the wizard differs from ours (another tab, a verified phone): say so, then re-sync.
        setConflict(t(conflictMessageKey(errorReason(error))));
        try {
          adopt(await api("/onboarding", { schema: onboardingStateSchema }));
        } catch {
          /* keep showing the current screen; the message above still explains */
        }
      }
    },
    [adopt],
  );

  // The step title is the new "page": announce it by moving focus there when the step changes.
  useEffect(() => {
    if (shownStep.current !== viewStep) {
      shownStep.current = viewStep;
      headingRef.current?.focus();
    }
  }, [viewStep]);

  const { steps } = state;
  const current = steps.find((entry) => entry.status === "current")?.step ?? steps[0]?.step;
  const active = steps.some((entry) => entry.step === viewStep)
    ? (viewStep as OnboardingInputStep)
    : current;

  if (state.done || active === undefined) {
    return (
      <div role="status" className="flex items-center justify-center gap-3 py-10 text-text-muted">
        <Spinner decorative />
        {leavingMessage ?? t("ui.loading")}
      </div>
    );
  }

  const index = steps.findIndex((entry) => entry.step === active);
  const previous = index > 0 ? steps[index - 1] : undefined;
  const Step = STEP_COMPONENTS[active];
  const copy = STEP_COPY[active];

  return (
    <div className="flex flex-col gap-6">
      <StepProgress current={index + 1} total={steps.length} />
      <header className="flex flex-col gap-2">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-3xl font-bold text-primary focus-visible:outline-none"
        >
          {t(copy.title)}
        </h1>
        <p className="text-lg text-text-muted">{t(copy.lead)}</p>
      </header>
      {conflict ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-4"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <p className="text-base text-text">{conflict}</p>
        </div>
      ) : null}
      <Step
        key={active}
        state={state}
        submit={submit}
        onBack={
          previous
            ? () => {
                setConflict(null);
                setViewStep(previous.step);
              }
            : undefined
        }
        submitLabel={index === steps.length - 1 ? t("onboarding.finish") : t("common.next")}
        nonce={nonce}
        freeMonthlyAnalyses={freeMonthlyAnalyses}
        facebookUrl={facebookUrl}
        catalog={catalog}
      />
    </div>
  );
}
