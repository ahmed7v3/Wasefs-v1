"use client";

import { cn } from "@wasfa/ui";
import { MoreVertical } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { ReactNode } from "react";

export interface MenuEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean | undefined;
  onSelect: () => void;
}

export interface ActionMenuProps {
  /** Accessible name of the trigger («المزيد من الإجراءات»). */
  label: string;
  entries: readonly MenuEntry[];
}

/**
 * A menu button (WAI-ARIA menu pattern): arrows move, Home/End jump, Esc closes and returns focus to
 * the trigger, a press outside closes. Every entry is a 44 px button, so nothing depends on hover.
 */
export function ActionMenu({ label, entries }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    items?.[0]?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (entries.length === 0) return null;

  const move = (delta: number | "first" | "last"): void => {
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    );
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next =
      delta === "first"
        ? 0
        : delta === "last"
          ? items.length - 1
          : (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-primary transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
      >
        <MoreVertical aria-hidden className="size-5" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              move("first");
            } else if (event.key === "End") {
              event.preventDefault();
              move("last");
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
          className="absolute end-0 top-full z-30 mt-1 flex min-w-56 max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border border-border bg-surface p-1 shadow-raised"
        >
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={entry.disabled}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                entry.onSelect();
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-start text-base transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50",
                entry.tone === "danger"
                  ? "text-danger hover:bg-danger-soft"
                  : "text-text hover:bg-primary-soft",
              )}
            >
              {entry.icon ? (
                <span aria-hidden className="shrink-0">
                  {entry.icon}
                </span>
              ) : null}
              <span className="min-w-0">{entry.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
