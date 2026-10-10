"use client";

import { t } from "@wasfa/shared/i18n";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

import { SUMMARY_THRESHOLD } from "../../lib/forms";

export interface ErrorSummaryProps {
  /** Message per field name (`form.errors`). */
  errors: Record<string, string>;
  /** Visible label per field name, so the list reads "Email: enter a valid email". */
  labels: Record<string, string>;
  /** Changes on every failed submit, so the summary takes focus each time. */
  focusKey: number;
}

/**
 * Lists the invalid fields at the top of a long form (DESIGN-SYSTEM §6.4). Shown only past
 * `SUMMARY_THRESHOLD` errors; fewer are announced on their own fields and the first one gets focus.
 */
export function ErrorSummary({ errors, labels, focusKey }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const names = Object.keys(errors);
  const visible = names.length > SUMMARY_THRESHOLD;

  useEffect(() => {
    if (visible) ref.current?.focus();
  }, [visible, focusKey]);

  if (!visible) return null;

  const focusField = (name: string) => {
    const element = ref.current?.closest("form")?.elements.namedItem(name);
    if (element instanceof HTMLElement) element.focus();
  };

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-md border border-danger/30 bg-danger-soft p-4 focus-visible:outline-none focus-visible:shadow-focus"
    >
      <p className="flex items-center gap-2 font-semibold text-danger">
        <TriangleAlert aria-hidden className="size-5 shrink-0" />
        {t("form.summaryTitle", { count: names.length })}
      </p>
      <ul className="mt-2 list-disc ps-6 text-text">
        {names.map((name) => (
          <li key={name}>
            <button
              type="button"
              onClick={() => {
                focusField(name);
              }}
              className="min-h-11 rounded-sm text-start text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
            >
              {labels[name] ?? name}
              {": "}
              {errors[name]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
