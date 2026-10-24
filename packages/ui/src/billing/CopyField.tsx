"use client";

import { t } from "@wasfa/shared/i18n/public";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../button";
import { cn } from "../cn";

export interface CopyFieldProps {
  label: string;
  /** The text a person must type or paste elsewhere (an account number, a reference). */
  value: string;
  className?: string | undefined;
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/** A labelled value with a copy button; the result is announced politely and never relies on colour. */
export function CopyField({ label, value, className }: CopyFieldProps) {
  const id = useId();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    setState((await copyText(value)) ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setState("idle");
    }, 2_500);
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={id} className="text-sm font-semibold text-text-muted">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <p
          dir="ltr"
          className="min-h-11 flex-1 select-all rounded-md border border-neutral-400 bg-neutral-50 px-4 py-2.5 text-start font-mono text-base font-semibold tabular-nums text-text"
        >
          {value}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void copy();
          }}
          aria-describedby={id}
        >
          {state === "copied" ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {state === "copied" ? t("billing.copy.copied") : t("billing.copy.action")}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {state === "copied" ? t("billing.copy.announced", { label }) : ""}
        {state === "failed" ? t("billing.copy.failed") : ""}
      </span>
    </div>
  );
}
