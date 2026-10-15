"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Lock } from "lucide-react";
import { useId } from "react";

import { cn } from "../cn";

import type { AiMode } from "@wasfa/shared/ai";

const MODES: ReadonlyArray<{ mode: AiMode; label: MessageKey; hint: MessageKey }> = [
  { mode: "fast", label: "chat.mode.fast", hint: "chat.mode.fast.hint" },
  { mode: "balanced", label: "chat.mode.balanced", hint: "chat.mode.balanced.hint" },
  { mode: "deep", label: "chat.mode.deep", hint: "chat.mode.deep.hint" },
];

export interface ModeToggleProps {
  value: AiMode;
  onChange: (mode: AiMode) => void;
  /** Modes the plan allows; the others show the plan badge and cannot be chosen. */
  allowed: readonly AiMode[];
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * سريع / متوازن / عميق as a segmented control. Native radios give arrow-key movement and the
 * right semantics for free; a locked mode is a disabled radio with the plan badge, never hidden.
 */
export function ModeToggle({
  value,
  onChange,
  allowed,
  disabled = false,
  className,
}: ModeToggleProps) {
  const name = useId();
  return (
    <fieldset
      disabled={disabled}
      className={cn(
        "m-0 flex min-w-0 gap-0.5 rounded-full bg-neutral-100 p-0.5 sm:gap-1 sm:p-1",
        className,
      )}
    >
      <legend className="sr-only">{t("chat.mode.label")}</legend>
      {MODES.map(({ mode, label, hint }) => {
        const locked = !allowed.includes(mode);
        const text = t(label);
        return (
          <label
            key={mode}
            title={locked ? t("chat.mode.locked", { mode: text }) : t(hint)}
            className={cn(
              "relative inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-2.5 text-sm sm:px-3 font-semibold text-text-muted transition-colors duration-150",
              "has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:shadow-focus",
              !locked && "hover:text-primary has-[:checked]:hover:text-on-primary",
              (locked || disabled) && "cursor-not-allowed opacity-70",
            )}
          >
            <input
              type="radio"
              name={name}
              value={mode}
              checked={value === mode}
              disabled={locked}
              onChange={() => {
                onChange(mode);
              }}
              className="peer absolute inset-0 size-full cursor-[inherit] opacity-0"
              aria-label={locked ? t("chat.mode.locked", { mode: text }) : text}
            />
            <span aria-hidden>{text}</span>
            {locked ? (
              <span
                aria-hidden
                className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 text-xs text-primary sm:px-2"
              >
                <Lock className="size-3" />
                <span className="hidden sm:inline">{t("chat.mode.planBadge")}</span>
              </span>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}
