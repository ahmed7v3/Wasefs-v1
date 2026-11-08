"use client";

import { DEFAULT_LOCALE } from "@wasfa/shared/i18n";
import { Button, Dialog, buttonStyles } from "@wasfa/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { isGrowthBusy, useGrowthBusy } from "../../lib/growth-busy";
import { trackGrowth } from "../../lib/growth-events";

import type { GrowthPrompt } from "@wasfa/shared/schemas/growth";

export interface PromptModalProps {
  prompt: GrowthPrompt;
  /** Called after a close (one tap, Esc, or the backdrop) so the slot forgets the prompt. */
  onClose: () => void;
}

/**
 * A calm, closable dialog for the two moments that earned one (trial over, credits used up), on the
 * dashboard and the analyze start screen only (the server decides; the engine never sends a modal
 * anywhere else). The platform dialog gives the focus trap, Esc and the labelled, inert background; a
 * visible close button, the close text and the backdrop all dismiss in one tap. It never opens while
 * an upload or an analysis is in progress: the busy flag is read once, when the answer arrives, and a
 * prompt that finds the person busy is dropped (no `shown` event), not queued for later. If the
 * person starts adding pages while it is already open, it closes by itself (no `dismissed` event:
 * they did not choose to close it).
 */
export function PromptModal({ prompt, onClose }: PromptModalProps) {
  const [open] = useState(() => !isGrowthBusy());
  const [visible, setVisible] = useState(open);
  const reported = useRef(false);
  const busy = useGrowthBusy();
  const copy = prompt.content?.[DEFAULT_LOCALE];

  useEffect(() => {
    if (!open || reported.current) return;
    reported.current = true;
    trackGrowth("prompt_shown", { kind: prompt.kind, form: "modal" }, true);
  }, [open, prompt.kind]);

  useEffect(() => {
    // Dropped because the person was busy: let the slot clear it without an event.
    if (!open) onClose();
  }, [open, onClose]);

  useEffect(() => {
    if (!busy || !visible) return;
    setVisible(false);
    onClose();
  }, [busy, visible, onClose]);

  if (!open || copy === undefined) return null;

  const dismiss = () => {
    if (!visible) return;
    setVisible(false);
    trackGrowth("prompt_dismissed", { kind: prompt.kind, form: "modal" }, true);
    onClose();
  };
  const clicked = (which: "primary" | "secondary") => {
    trackGrowth("prompt_clicked", { kind: prompt.kind, form: "modal", target: which }, true);
  };

  return (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
      title={copy.title === "" ? copy.body : copy.title}
      description={copy.title === "" ? undefined : copy.body}
      actions={
        <>
          <Button variant="ghost" name="prompt-dismiss" onClick={dismiss}>
            {copy.close}
          </Button>
          {copy.secondary !== undefined && prompt.secondaryHref !== undefined ? (
            <Link
              href={prompt.secondaryHref}
              className={buttonStyles({ variant: "secondary" })}
              data-testid="prompt-secondary"
              onClick={() => {
                clicked("secondary");
              }}
            >
              {copy.secondary}
            </Link>
          ) : null}
          <Link
            href={prompt.cta.href ?? "/pricing"}
            className={buttonStyles()}
            data-testid="prompt-cta"
            onClick={() => {
              clicked("primary");
            }}
          >
            {copy.cta}
          </Link>
        </>
      }
    />
  );
}
