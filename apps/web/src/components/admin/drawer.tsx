"use client";

import { t } from "@wasfa/shared/i18n";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import type { ReactNode } from "react";

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading and accessible name of the drawer. */
  title: ReactNode;
  children: ReactNode;
}

/**
 * Detail drawer of the admin tables, opened by a URL param. Built on the native modal `<dialog>`
 * like `Dialog`: the browser gives the focus trap, the inert page and Esc; focus returns to the row
 * that opened it. It slides in from the inline-END edge and is full width on a phone.
 */
export function DetailDrawer({ open, onClose, title, children }: DetailDrawerProps) {
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
        // The URL is the state: the parent removes the param, and the effect closes the element.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="admin-drawer fixed inset-y-0 start-auto end-0 z-30 m-0 h-dvh max-h-none w-full max-w-xl overflow-y-auto bg-surface p-0 text-text shadow-raised backdrop:bg-neutral-900/50 sm:rounded-s-2xl"
    >
      {open ? (
        <div className="flex min-h-full flex-col">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3">
            <h2 id={titleId} className="min-w-0 truncate font-heading text-xl font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("ui.close")}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-5 p-5">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
