"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, useToast } from "@wasfa/ui";
import { Copy } from "lucide-react";

export interface CopyBlockProps {
  label: string;
  text: string;
  hint?: string | undefined;
  /** Accessible name of the copy button; defaults to the generic "Copy". */
  copyLabel?: string | undefined;
  /** Keep line breaks (guide text, messages) instead of one line (URLs). */
  multiline?: boolean | undefined;
}

/** A labelled, read-only block of text with a copy button. The text is never logged or stored. */
export function CopyBlock({ label, text, hint, copyLabel, multiline = false }: CopyBlockProps) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: t("admin.pub.secret.copied") });
    } catch {
      // Clipboard blocked: the text stays selectable in the block.
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold text-text">{label}</p>
        <Button
          type="button"
          variant="secondary"
          name="copy"
          aria-label={
            copyLabel ? `${copyLabel}: ${label}` : `${t("admin.pub.secret.copy")}: ${label}`
          }
          onClick={() => {
            void copy();
          }}
        >
          <Copy aria-hidden className="size-4" />
          {copyLabel ?? t("admin.pub.secret.copy")}
        </Button>
      </div>
      {hint ? <p className="text-sm text-text-muted">{hint}</p> : null}
      <pre
        dir={multiline ? "auto" : "ltr"}
        className={
          multiline
            ? "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-3 text-sm text-text"
            : "overflow-x-auto rounded-lg bg-neutral-100 p-3 font-mono text-sm text-text"
        }
      >
        {text}
      </pre>
    </div>
  );
}
