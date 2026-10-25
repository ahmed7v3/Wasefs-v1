"use client";

import { t } from "@wasfa/shared/i18n";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export interface FullscreenDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * A full-screen modal (the live preview on a phone or a narrow desktop). The shared `Dialog` is a
 * bottom sheet that stops at 90 % of the screen, which is too little to read an article in; this uses
 * the same native `<dialog>` + `showModal()` (focus trap, inert page, Esc) at full size, and returns
 * focus to the opener on close.
 */
export function FullscreenDialog({ open, onClose, title, children }: FullscreenDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      opener?.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      className="fixed inset-0 z-40 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-bg p-0 text-text"
    >
      <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4 px-4 pb-10">
        <div className="sticky top-0 z-10 -mx-4 flex min-h-14 items-center justify-between gap-2 border-b border-border bg-surface px-4">
          <h2 id={titleId} className="font-heading text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("ui.close")}
            className="inline-flex size-11 items-center justify-center rounded-lg text-neutral-600 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>
  );
}
