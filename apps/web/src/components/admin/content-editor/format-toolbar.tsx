"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import {
  BookOpen,
  Bold,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Info,
  Italic,
  Lightbulb,
  Link as LinkIcon,
  List,
  ListOrdered,
  MousePointerClick,
  Pill,
  Quote,
  Superscript,
  Table,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { TOOLBAR_ACTIONS, type ToolbarAction } from "../../../lib/content-editor/toolbar";

export const TOOLBAR_ICONS: Record<ToolbarAction, LucideIcon> = {
  h2: Heading2,
  h3: Heading3,
  bold: Bold,
  italic: Italic,
  link: LinkIcon,
  bullet: List,
  numbered: ListOrdered,
  quote: Quote,
  table: Table,
  image: ImageIcon,
  note: Info,
  warning: TriangleAlert,
  tip: Lightbulb,
  drug: Pill,
  glossary: BookOpen,
  footnote: Superscript,
  cta: MousePointerClick,
};

export const TOOLBAR_LABELS: Record<ToolbarAction, MessageKey> = {
  h2: "admin.editor.toolbar.h2",
  h3: "admin.editor.toolbar.h3",
  bold: "admin.editor.toolbar.bold",
  italic: "admin.editor.toolbar.italic",
  link: "admin.editor.toolbar.link",
  bullet: "admin.editor.toolbar.bullet",
  numbered: "admin.editor.toolbar.numbered",
  quote: "admin.editor.toolbar.quote",
  table: "admin.editor.toolbar.table",
  image: "admin.editor.toolbar.image",
  note: "admin.editor.toolbar.note",
  warning: "admin.editor.toolbar.warning",
  tip: "admin.editor.toolbar.tip",
  drug: "admin.editor.toolbar.drug",
  glossary: "admin.editor.toolbar.glossary",
  footnote: "admin.editor.toolbar.footnote",
  cta: "admin.editor.toolbar.cta",
};

export interface FormatToolbarProps {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean | undefined;
  /**
   * `fixed`: pinned `inset-block-end` px above the bottom (the on-screen keyboard height);
   * `sticky`: stays at the top of the page while writing (desktop) or at the bottom (no Visual Viewport).
   */
  placement:
    | { mode: "static" }
    | { mode: "sticky-top" }
    | { mode: "sticky-bottom" }
    | { mode: "fixed"; bottom: number };
}

/**
 * The formatting toolbar: one horizontally scrollable row of 44 px buttons (`overflow-x: auto`, so 17
 * actions fit a 320 px screen). Roving tabindex with arrow keys that follow the reading direction.
 * `onPointerDown` prevents the default so the textarea keeps its focus and selection while a button is
 * pressed: otherwise the on-screen keyboard would close on every tap.
 */
export function FormatToolbar({ onAction, disabled, placement }: FormatToolbarProps) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const focusButton = (index: number): void => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
    const next = (index + TOOLBAR_ACTIONS.length) % TOOLBAR_ACTIONS.length;
    setActive(next);
    buttons?.[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const rtl =
      (listRef.current?.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir) ===
      "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward) focusButton(active + 1);
    else if (event.key === backward) focusButton(active - 1);
    else if (event.key === "Home") focusButton(0);
    else if (event.key === "End") focusButton(TOOLBAR_ACTIONS.length - 1);
    else return;
    event.preventDefault();
  };

  const style: CSSProperties | undefined =
    placement.mode === "fixed" ? { insetBlockEnd: `${String(placement.bottom)}px` } : undefined;

  return (
    <div
      className={cn(
        "z-20 border-border bg-surface",
        placement.mode === "fixed" && "fixed inset-x-0 border-t shadow-raised",
        placement.mode === "sticky-bottom" && "sticky bottom-0 border-t",
        placement.mode === "sticky-top" && "sticky top-16 rounded-t-lg border-b",
        placement.mode === "static" && "border-b",
      )}
      style={style}
    >
      <div
        ref={listRef}
        role="toolbar"
        aria-label={t("admin.editor.toolbar.label")}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex overflow-x-auto overscroll-x-contain px-1"
      >
        {TOOLBAR_ACTIONS.map((action, index) => {
          const Icon = TOOLBAR_ICONS[action];
          const label = t(TOOLBAR_LABELS[action]);
          return (
            <button
              key={action}
              type="button"
              disabled={disabled}
              aria-label={label}
              title={label}
              tabIndex={index === active ? 0 : -1}
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onFocus={() => {
                setActive(index);
              }}
              onClick={() => {
                onAction(action);
              }}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-primary transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50"
            >
              <Icon aria-hidden className="size-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
