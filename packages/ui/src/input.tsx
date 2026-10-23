"use client";

import { t } from "@wasfa/shared/i18n/public";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { cn } from "./cn";
import { controlStyles } from "./control-styles";

import type { ComponentProps, ReactNode } from "react";

export interface InputProps extends ComponentProps<"input"> {
  /** Marks the control invalid (`aria-invalid`). A surrounding `Field` does this for you. */
  invalid?: boolean | undefined;
  /** Decorative icon at the inline start (right in RTL). */
  startIcon?: ReactNode;
  /** Interactive node at the inline end, e.g. the show/hide password toggle. Must be 44 px wide. */
  endAction?: ReactNode;
  /** Forces an LTR run for email, phone, codes and URLs (DESIGN-SYSTEM §4.5). */
  ltr?: boolean | undefined;
}

export function Input({
  invalid,
  startIcon,
  endAction,
  ltr,
  className,
  disabled,
  "aria-invalid": ariaInvalid,
  ...props
}: InputProps) {
  return (
    <div className="relative w-full">
      {startIcon ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-0 flex w-11 items-center justify-center text-neutral-600"
        >
          {startIcon}
        </span>
      ) : null}
      <input
        className={cn(
          controlStyles,
          startIcon && "ps-11",
          endAction && "pe-12",
          ltr && "text-start",
          className,
        )}
        {...(ltr ? { dir: "ltr" } : {})}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-invalid={invalid ? true : ariaInvalid}
        {...props}
      />
      {endAction ? (
        <span className="absolute inset-y-0 end-0 flex items-center">{endAction}</span>
      ) : null}
    </div>
  );
}

export type PasswordInputProps = Omit<InputProps, "type" | "endAction">;

/** Password field with a show/hide toggle; the browser password manager keeps working (plain input). */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      endAction={
        <button
          type="button"
          onClick={() => {
            setVisible((v) => !v);
          }}
          aria-label={visible ? t("ui.hidePassword") : t("ui.showPassword")}
          className="inline-flex size-11 items-center justify-center rounded-md text-neutral-600 transition-colors duration-150 hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Icon aria-hidden className="size-5" />
        </button>
      }
    />
  );
}
