// No "use client": Field only needs `useId`, and staying a server-compatible component lets a server
// component pass the render-prop child (functions cannot cross the server/client boundary).
import { t } from "@wasfa/shared/i18n/public";
import { CircleAlert } from "lucide-react";
import { useId } from "react";

import { cn } from "./cn";

import type { ReactNode } from "react";

/** Props to spread on the single control inside a `Field`. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  required: boolean | undefined;
}

export interface FieldProps {
  /** Visible label above the control: never placeholder-only (DESIGN-SYSTEM §5.2). */
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean | undefined;
  /** Set when the error appears after a submit so screen readers announce it (`role="alert"`). */
  announceError?: boolean | undefined;
  className?: string | undefined;
  /** Render prop so the ids/ARIA reach the control without cloning elements. */
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required,
  announceError = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-base font-semibold text-text">
        {label}
        {required ? (
          <span className="ms-1 text-sm font-normal text-text-muted">{t("ui.required")}</span>
        ) : null}
      </label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
        required: required || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          {...(announceError ? { role: "alert" as const } : {})}
          className="flex items-start gap-1.5 text-sm text-danger"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
