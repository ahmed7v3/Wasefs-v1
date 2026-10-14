"use client";

import { t } from "@wasfa/shared/i18n";
import { Brain, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "../cn";

export interface ThinkingPanelProps {
  /** What the model reasoned so far (plain text). */
  text: string;
  /** Still thinking: the header reads "يفكّر…". */
  streaming: boolean;
  /** How long it thought, once it is done. */
  seconds?: number | undefined;
  className?: string | undefined;
}

/** Collapsed by default: the header says "يفكّر…" while streaming, then "فكّر لمدة N ث" with an expand control. */
export function ThinkingPanel({ text, streaming, seconds, className }: ThinkingPanelProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const label = streaming
    ? t("chat.thinking.active")
    : t("chat.thinking.done", { seconds: seconds ?? 0 });
  return (
    <section className={cn("rounded-md border border-border bg-neutral-50", className)}>
      <h4 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setOpen((current) => !current);
          }}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-start text-sm font-semibold text-text-muted hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Brain aria-hidden className={cn("size-4 shrink-0", streaming && "animate-pulse")} />
          <span className="flex-1">{label}</span>
          <span className="sr-only">
            {open ? t("chat.thinking.collapse") : t("chat.thinking.expand")}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </h4>
      <div
        id={bodyId}
        hidden={!open}
        className="border-t border-border px-3 py-2 text-sm leading-7 whitespace-pre-wrap text-text-muted"
      >
        {text}
      </div>
    </section>
  );
}
