"use client";

import { t } from "@wasfa/shared/i18n";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ReactNode } from "react";

/** The widest viewport that still uses the drawer: `lg` (1024 px) and up shows the sidebar instead. */
const DESKTOP_QUERY = "(min-width: 1024px)";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the drawer. */
  label: string;
  children: ReactNode;
}

/**
 * Navigation drawer below `lg`, built on the native modal `<dialog>` like `Dialog`: the browser
 * gives the focus trap, the inert page and Esc. It slides in from the inline-start edge (the right
 * in RTL) and returns focus to the button that opened it.
 */
export function Drawer({ open, onClose, label, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);

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

  // Growing the window past `lg` replaces the drawer with the sidebar: a leftover modal would trap the page.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) onClose();
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [open, onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="drawer fixed inset-y-0 start-0 end-auto z-30 m-0 h-dvh max-h-none w-72 max-w-[85vw] overflow-y-auto rounded-e-2xl bg-surface p-0 text-text shadow-raised backdrop:bg-neutral-900/50"
    >
      <div className="flex min-h-full flex-col gap-4 p-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.close")}
            className="inline-flex size-11 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
