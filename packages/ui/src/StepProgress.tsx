import { t } from "@wasfa/shared/i18n";
import { Check } from "lucide-react";

import { cn } from "./cn";
import { Spinner } from "./spinner";

import type { ReactNode } from "react";

export interface StepProgressStep {
  id: string;
  label: string;
}

export interface StepProgressProps {
  steps: readonly StepProgressStep[];
  /** Index of the step in progress; `steps.length` means every step is done. */
  current: number;
  /** Seconds since the analysis started; shown as m:ss. Omit to hide it. */
  elapsedSeconds?: number | undefined;
  /** Calm line under the list ("you can leave this page"). */
  note?: ReactNode;
  className?: string | undefined;
}

/** m:ss with Western digits (DESIGN-SYSTEM §4). */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

type StepState = "done" | "current" | "pending";

const stateWords: Record<
  StepState,
  "rx.progress.state.done" | "rx.progress.state.current" | "rx.progress.state.pending"
> = {
  done: "rx.progress.state.done",
  current: "rx.progress.state.current",
  pending: "rx.progress.state.pending",
};

/**
 * A calm list of the analysis steps. The only motion is the existing `Spinner` on the current step.
 * One polite status line announces the step that begins; the clock is plain text, not a live region,
 * so it does not interrupt a screen reader every second.
 */
export function StepProgress({
  steps,
  current,
  elapsedSeconds,
  note,
  className,
}: StepProgressProps) {
  const currentStep = steps[Math.min(current, steps.length - 1)];
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <p role="status" className="sr-only">
        {currentStep && current < steps.length
          ? t("rx.progress.stepOf", {
              current: current + 1,
              total: steps.length,
              label: currentStep.label,
            })
          : ""}
      </p>
      <ol aria-label={t("rx.progress.stepsLabel")} className="flex flex-col gap-2">
        {steps.map((step, index) => {
          const state: StepState =
            index < current ? "done" : index === current ? "current" : "pending";
          return (
            <li
              key={step.id}
              data-step={step.id}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-base",
                state === "current" && "bg-primary-soft font-semibold text-primary",
                state === "done" && "text-text",
                state === "pending" && "text-text-muted",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-7 shrink-0 items-center justify-center rounded-full border",
                  state === "done" && "border-success bg-success-soft text-success",
                  state === "current" && "border-primary bg-surface text-primary",
                  state === "pending" && "border-neutral-400 bg-surface text-neutral-600",
                )}
              >
                {state === "done" ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : state === "current" ? (
                  <Spinner decorative className="size-4" />
                ) : (
                  <span className="text-sm tabular-nums">{index + 1}</span>
                )}
              </span>
              <span>{step.label}</span>
              <span className="sr-only">{t(stateWords[state])}</span>
            </li>
          );
        })}
      </ol>
      {elapsedSeconds === undefined ? null : (
        <p className="text-sm tabular-nums text-text-muted">
          {t("rx.progress.elapsed", { time: formatElapsed(elapsedSeconds) })}
        </p>
      )}
      {note ? <p className="text-base text-text-muted">{note}</p> : null}
    </div>
  );
}
