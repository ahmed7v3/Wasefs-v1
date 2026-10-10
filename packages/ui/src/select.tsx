import { ChevronDown } from "lucide-react";

import { cn } from "./cn";
import { controlStyles } from "./control-styles";

import type { ComponentProps } from "react";

export interface SelectProps extends ComponentProps<"select"> {
  /** Marks the control invalid (`aria-invalid`). A surrounding `Field` does this for you. */
  invalid?: boolean | undefined;
}

/** Native `<select>` (best on mobile, free a11y) styled like `Input`; pass `<option>`s as children. */
export function Select({
  invalid,
  className,
  disabled,
  children,
  "aria-invalid": ariaInvalid,
  ...props
}: SelectProps) {
  return (
    <div className="relative w-full">
      <select
        className={cn(controlStyles, "appearance-none pe-11", className)}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-invalid={invalid ? true : ariaInvalid}
        {...props}
      >
        {children}
      </select>
      {/* The chevron points down, so it does not mirror in RTL. */}
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute end-4 top-1/2 size-5 -translate-y-1/2 text-neutral-600"
      />
    </div>
  );
}
