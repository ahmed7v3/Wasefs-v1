"use client";

import { createContext, useContext, useId, useState } from "react";

import { cn } from "./cn";

import type { ComponentProps, KeyboardEvent } from "react";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tab, TabList and TabPanel must be used inside <Tabs>");
  }
  return context;
}

// Tab values go into element ids, so keep them to simple tokens.
const idPart = (value: string) => value.replace(/\s+/g, "-");

export interface TabsProps extends Omit<ComponentProps<"div">, "defaultValue"> {
  /** Controlled value; pair with `onValueChange`. */
  value?: string | undefined;
  /** Initial value when uncontrolled. */
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
}

export function Tabs({
  value: controlled,
  defaultValue = "",
  onValueChange,
  className,
  ...props
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const baseId = useId();
  const value = controlled ?? internal;
  const setValue = (next: string) => {
    if (controlled === undefined) {
      setInternal(next);
    }
    onValueChange?.(next);
  };
  return (
    <TabsContext value={{ value, setValue, baseId }}>
      <div className={className} {...props} />
    </TabsContext>
  );
}

/**
 * Text direction of the list, read from the closest `dir` attribute. The attribute is what the app
 * sets (`<html dir="rtl">`), and unlike computed style it is exact in every environment.
 */
function isRtl(element: HTMLElement): boolean {
  const dir = element.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir;
  return dir === "rtl";
}

export function TabList({ className, onKeyDown, ...props }: ComponentProps<"div">) {
  const { setValue } = useTabsContext();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'),
    );
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current === -1) {
      return;
    }
    // Arrows follow the reading direction: in RTL, ArrowLeft moves to the NEXT tab.
    const forward = isRtl(event.currentTarget) ? "ArrowLeft" : "ArrowRight";
    const backward = isRtl(event.currentTarget) ? "ArrowRight" : "ArrowLeft";
    let target: number;
    if (event.key === forward) {
      target = (current + 1) % tabs.length;
    } else if (event.key === backward) {
      target = (current - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      target = 0;
    } else if (event.key === "End") {
      target = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const next = tabs[target];
    next?.focus();
    // Automatic activation: selection follows focus (cheap panels, fewer keystrokes).
    const nextValue = next?.dataset["value"];
    if (nextValue !== undefined) {
      setValue(nextValue);
    }
  };

  return (
    <div
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
      {...props}
    />
  );
}

export interface TabProps extends Omit<ComponentProps<"button">, "value"> {
  value: string;
}

export function Tab({ value, className, onClick, ...props }: TabProps) {
  const { value: selected, setValue, baseId } = useTabsContext();
  const active = selected === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${idPart(value)}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${idPart(value)}`}
      // Roving tabindex: only the active tab is in the tab order; arrows move between tabs.
      tabIndex={active ? 0 : -1}
      data-value={value}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setValue(value);
        }
      }}
      className={cn(
        "-mb-px inline-flex min-h-11 shrink-0 items-center justify-center border-b-2 px-4 text-base font-semibold transition-colors duration-150",
        "focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-primary text-primary"
          : "border-transparent text-text-muted hover:text-text",
        className,
      )}
      {...props}
    />
  );
}

export interface TabPanelProps extends Omit<ComponentProps<"div">, "value"> {
  value: string;
}

export function TabPanel({ value, className, ...props }: TabPanelProps) {
  const { value: selected, baseId } = useTabsContext();
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${idPart(value)}`}
      aria-labelledby={`${baseId}-tab-${idPart(value)}`}
      hidden={selected !== value}
      tabIndex={0}
      className={cn("pt-4 focus-visible:outline-none focus-visible:shadow-focus", className)}
      {...props}
    />
  );
}
