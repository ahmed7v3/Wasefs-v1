"use client";

import { cn } from "@wasfa/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { ReactNode } from "react";

export interface PopoverMenuProps {
  /** Accessible name of the trigger button (needed when its content is only an icon). */
  label: string;
  /** What the trigger button shows. */
  trigger: ReactNode;
  /** Classes of the trigger button. */
  triggerClassName?: string | undefined;
  /** Where the panel opens relative to the trigger; it aligns to the inline-end edge. */
  placement?: "below" | "above";
  panelClassName?: string | undefined;
  /** The panel content; `close` lets an item close the panel after it acts. */
  children: (close: () => void) => ReactNode;
}

const FOCUSABLE = "a[href], button:not([disabled])";

/**
 * A small popover opened by a button (the account menu, the contact hub). Disclosure pattern:
 * `aria-expanded` on the trigger, focus moves to the first item on open, Esc closes and returns
 * focus to the trigger; a click outside or tabbing out of the panel closes it too.
 */
export function PopoverMenu({
  label,
  trigger,
  triggerClassName,
  placement = "below",
  panelClassName,
  children,
}: PopoverMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    // Tabbing past the last item moves focus out of the popover: close without stealing it back.
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, close]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          className={cn(
            "absolute end-0 z-20 min-w-56 rounded-xl border border-border/60 bg-surface p-2 shadow-raised",
            placement === "below" ? "top-full mt-2" : "bottom-full mb-3",
            panelClassName,
          )}
        >
          {children(() => {
            close(true);
          })}
        </div>
      ) : null}
    </div>
  );
}
