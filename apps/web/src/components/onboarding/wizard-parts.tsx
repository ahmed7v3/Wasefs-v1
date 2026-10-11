"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, cn } from "@wasfa/ui";
import { ArrowLeft, CircleAlert } from "lucide-react";

import type { ReactNode } from "react";

export interface StepProgressProps {
  /** 1-based position among the steps that apply to this user. */
  current: number;
  total: number;
}

/**
 * "Step N of M" text plus a segmented bar: both say the same thing, so nothing relies on the bar
 * alone. One segment per applicable step (no inline `style`: the CSP forbids style attributes).
 */
export function StepProgress({ current, total }: StepProgressProps) {
  const text = t("onboarding.stepOf", { current, total });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-text-muted">{text}</p>
      <div
        role="progressbar"
        aria-label={t("onboarding.progressLabel")}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={text}
        className="flex gap-1"
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-2 flex-1 rounded-full transition-colors duration-200 ease-standard",
              index < current ? "bg-primary" : "bg-primary-soft",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export interface StepActionsProps {
  /** Absent on the first step. */
  onBack: (() => void) | undefined;
  submitLabel: string;
  loading?: boolean | undefined;
  /** Replaces the submit button, for steps that have their own buttons. */
  children?: ReactNode;
}

/** Back (a ghost button, never the primary action) and the submit button of a step. */
export function StepActions({ onBack, submitLabel, loading, children }: StepActionsProps) {
  return (
    <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button type="button" variant="ghost" name="back" onClick={onBack}>
          {/* Direction arrows mirror in RTL (DESIGN-SYSTEM §4.4): "back" points toward the start. */}
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t("common.back")}
        </Button>
      ) : (
        <span />
      )}
      {children ?? (
        <Button type="submit" size="lg" name="next" loading={loading}>
          {submitLabel}
        </Button>
      )}
    </div>
  );
}

export interface ChoiceCardProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}

/**
 * A large radio option drawn as a card. The real radio stays in the tree (visually hidden), so the
 * arrow keys, the group name and form semantics are the browser's; the card only styles its state.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  icon,
}: ChoiceCardProps) {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => {
          onChange(value);
        }}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex min-h-11 items-center gap-4 rounded-xl border bg-surface p-4 transition-colors duration-150",
          "border-neutral-400 hover:border-neutral-600",
          "peer-checked:border-primary peer-checked:bg-primary-soft",
          "peer-focus-visible:shadow-focus",
        )}
      >
        {icon ? (
          <span
            aria-hidden
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary [&>svg]:size-6"
          >
            {icon}
          </span>
        ) : null}
        <span className="flex flex-col">
          <span className="text-base font-semibold text-text">{title}</span>
          {description ? <span className="text-sm text-text-muted">{description}</span> : null}
        </span>
      </span>
    </label>
  );
}

/** An error line for a group of controls (a `Field` covers single controls). */
export function GroupError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
