import { cn } from "./cn";
import { controlStyles } from "./control-styles";

import type { ComponentProps } from "react";

export interface TextareaProps extends ComponentProps<"textarea"> {
  /** Marks the control invalid (`aria-invalid`). A surrounding `Field` does this for you. */
  invalid?: boolean | undefined;
  /** Forces an LTR run for ids, codes, URLs and domains (DESIGN-SYSTEM §4.5). */
  ltr?: boolean | undefined;
}

/** Multi-line text control styled like `Input` (reasons, one-value-per-line lists). */
export function Textarea({
  invalid,
  ltr,
  className,
  disabled,
  "aria-invalid": ariaInvalid,
  ...props
}: TextareaProps) {
  return (
    <textarea
      className={cn(controlStyles, "min-h-24 resize-y py-2.5", ltr && "text-start", className)}
      {...(ltr ? { dir: "ltr" } : {})}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-invalid={invalid ? true : ariaInvalid}
      {...props}
    />
  );
}
