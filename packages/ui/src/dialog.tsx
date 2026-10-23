"use client";

import { t } from "@wasfa/shared/i18n/public";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { cn } from "./cn";

import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Body content between the description and the actions. */
  children?: ReactNode;
  /** Buttons, laid out at the inline end. Destructive confirmations use an explicit verb button. */
  actions?: ReactNode;
  className?: string | undefined;
}

/**
 * Modal built on the native `<dialog>`: `showModal()` gives the focus trap, inert page and Esc for free.
 * Controlled (`open` / `onOpenChange`); focus returns to the element that opened it.
 * Bottom sheet below `sm`, centred `rounded-xl shadow-raised` panel above.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) {
      return;
    }
    // Remember the opener ourselves: restoring focus must not depend on the browser's own heuristic.
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
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Keep the state controlled: the parent decides, the effect cleanup closes the element.
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) {
          onOpenChange(false);
        }
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself (the panel is padded inside).
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
      className={cn(
        "z-30 m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto bg-surface p-0 text-text shadow-raised backdrop:bg-neutral-900/50",
        // Mobile: bottom sheet. Tailwind's reset zeroes the UA centring margin, so `sm:m-auto` restores it.
        "fixed inset-x-0 top-auto bottom-0 rounded-t-xl",
        "sm:inset-0 sm:m-auto sm:h-fit sm:max-w-lg sm:rounded-xl",
        className,
      )}
    >
      <div className="relative flex flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-col gap-2 pe-10">
          <h2 id={titleId} className="font-heading text-xl font-semibold text-text">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-base text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {children}
        {actions ? <div className="mt-2 flex flex-wrap justify-end gap-3">{actions}</div> : null}
        {/* Last in DOM so the initial focus lands on the content or actions, not on the close icon. */}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
          aria-label={t("ui.close")}
          className="absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
    </dialog>
  );
}
