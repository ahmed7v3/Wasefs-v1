"use client";

import { cn } from "@wasfa/ui";

import type { ReactNode } from "react";

export interface SwitchRowProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
}

/**
 * An on/off setting as a real `role="switch"` button. The whole row is the 44 px target; the thumb
 * slides toward the inline end when on, so it mirrors correctly in RTL (logical `start`/`end` offsets).
 */
export function SwitchRow({ label, hint, checked, onChange, disabled }: SwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-start focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-base text-text">{label}</span>
        {hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150",
          checked ? "border-primary bg-primary" : "border-neutral-400 bg-neutral-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-all duration-150",
            checked ? "end-0.5" : "start-0.5",
          )}
        />
      </span>
    </button>
  );
}
