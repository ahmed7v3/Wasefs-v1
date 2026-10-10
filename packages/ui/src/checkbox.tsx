import { Check } from "lucide-react";

import { cn } from "./cn";

import type { ComponentProps, ReactNode } from "react";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type" | "children"> {
  /** Visible label, placed at the inline end of the box. The whole label row is the 44 px hit area. */
  label: ReactNode;
  invalid?: boolean | undefined;
  /** Classes of the label row (the native props and `ref` go to the `<input>`). */
  className?: string | undefined;
}

/** Native checkbox drawn as a 24 px box; the real input stays in the tree, so keyboard and forms just work. */
export function Checkbox({
  label,
  invalid,
  className,
  disabled,
  "aria-invalid": ariaInvalid,
  ...props
}: CheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex min-h-11 items-center gap-3 text-base text-text",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <span className="relative inline-flex size-6 shrink-0">
        <input
          type="checkbox"
          className={cn(
            "peer size-6 cursor-[inherit] appearance-none rounded-sm border border-neutral-400 bg-surface transition-colors duration-150",
            "hover:border-neutral-600 checked:border-primary checked:bg-primary",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "aria-invalid:border-danger",
          )}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          aria-invalid={invalid ? true : ariaInvalid}
          {...props}
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-4 text-on-primary opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
        />
      </span>
      <span>{label}</span>
    </label>
  );
}
